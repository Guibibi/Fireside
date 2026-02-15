import {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  preferredCameraDeviceId,
  savePreferredAudioInputDeviceId,
  savePreferredAudioOutputDeviceId,
  savePreferredCameraDeviceId,
  voiceOutgoingVolume,
} from "../../stores/settings";
import { audioInputConstraint, cameraInputConstraint } from "./constraints";
import { isMissingDeviceError } from "./errors";
import {
  cameraEnabled,
  deviceChangeListenerRegistered,
  handlingDeviceChange,
  initializedForChannelId,
  micProducer,
  micStream,
  micTrack,
  microphoneMuted,
  remoteAudioElements,
  sendTransport,
  setDeviceChangeListenerRegistered,
  setHandlingDeviceChange,
  setMicProducer,
  setMicStream,
  setMicTrack,
  setCameraError,
  cameraProducer,
  cameraStream,
  cameraTrack,
  setCameraEnabled,
  setCameraProducer,
  setCameraStream,
  setCameraTrack,
} from "./state";
import { notifyCameraStateSubscribers } from "./subscriptions";
import type { AudioDeviceInventory, CameraDeviceOption, SinkableAudioElement } from "./types";
import { startMicLevelMonitoring } from "./voiceActivity";
import {
  activateMicrophoneProcessing,
  createProcessedMicrophoneTrack,
  disposePendingMicrophoneProcessing,
} from "./microphoneProcessing";

export function isSpeakerSelectionSupported(): boolean {
  const audio = document.createElement("audio") as SinkableAudioElement;
  return typeof audio.setSinkId === "function";
}

function normalizeDeviceLabel(device: MediaDeviceInfo, fallbackPrefix: string, fallbackIndex: number) {
  if (device.label.trim().length > 0) {
    return device.label;
  }

  return `${fallbackPrefix} ${fallbackIndex}`;
}

export async function listAudioDevices(): Promise<AudioDeviceInventory> {
  const devices = await navigator.mediaDevices.enumerateDevices();

  const inputsRaw = devices.filter((device) => device.kind === "audioinput");
  const outputsRaw = devices.filter((device) => device.kind === "audiooutput");

  const inputs = inputsRaw
    .map((device, index) => ({
      deviceId: device.deviceId,
      kind: device.kind,
      label: normalizeDeviceLabel(device, "Microphone", index + 1),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const outputs = outputsRaw
    .map((device, index) => ({
      deviceId: device.deviceId,
      kind: device.kind,
      label: normalizeDeviceLabel(device, "Speaker", index + 1),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    inputs,
    outputs,
  };
}

export async function listCameraDevices(): Promise<CameraDeviceOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();

  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      kind: device.kind,
      label: normalizeDeviceLabel(device, "Camera", index + 1),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function applySpeakerDeviceToElement(audio: HTMLAudioElement, deviceId: string | null) {
  if (!isSpeakerSelectionSupported()) {
    return;
  }

  const sinkable = audio as SinkableAudioElement;
  await sinkable.setSinkId?.(deviceId ?? "");
}

export async function setPreferredMicrophoneDevice(deviceId: string | null) {
  if (!initializedForChannelId || !sendTransport) {
    savePreferredAudioInputDeviceId(deviceId);
    return;
  }

  const nextStream = await navigator.mediaDevices.getUserMedia({
    audio: audioInputConstraint(deviceId),
    video: false,
  });
  const [nextTrack] = nextStream.getAudioTracks();

  if (!nextTrack) {
    nextStream.getTracks().forEach((track) => track.stop());
    throw new Error("Microphone track was not available");
  }

  const previousStream = micStream;
  const previousTrack = micTrack;
  let processingSession: ReturnType<typeof createProcessedMicrophoneTrack> | null = null;

  try {
    processingSession = createProcessedMicrophoneTrack(nextStream, voiceOutgoingVolume(), microphoneMuted);

    if (micProducer) {
      await micProducer.replaceTrack({ track: processingSession.track });
    } else {
      const produced = await sendTransport.produce({
        track: processingSession.track,
        stopTracks: false,
        appData: {
          source: "microphone",
          routingMode: "sfu",
        },
      });

      produced.on("transportclose", () => {
        setMicProducer(null);
      });

      produced.on("trackended", () => {
        setMicProducer(null);
      });

      setMicProducer(produced);
    }

    activateMicrophoneProcessing(processingSession);

    setMicStream(nextStream);
    setMicTrack(processingSession.track);
    startMicLevelMonitoring(initializedForChannelId, nextStream);
    previousTrack?.stop();
    previousStream?.getTracks().forEach((track) => track.stop());
    savePreferredAudioInputDeviceId(deviceId);
  } catch (error) {
    if (processingSession) {
      disposePendingMicrophoneProcessing(processingSession);
    }
    nextStream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export async function setPreferredCameraDevice(deviceId: string | null) {
  if (!cameraEnabled || !initializedForChannelId || !sendTransport) {
    savePreferredCameraDeviceId(deviceId);
    return;
  }

  const nextStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: cameraInputConstraint(deviceId),
  });

  const [nextTrack] = nextStream.getVideoTracks();
  if (!nextTrack) {
    nextStream.getTracks().forEach((track) => track.stop());
    throw new Error("Camera track was not available");
  }

  const previousTrack = cameraTrack;
  const previousStream = cameraStream;

  try {
    await cameraProducer?.replaceTrack({ track: nextTrack });
    setCameraTrack(nextTrack);
    setCameraStream(nextStream);
    setCameraEnabled(true);
    setCameraError(null);
    savePreferredCameraDeviceId(deviceId);
    notifyCameraStateSubscribers();
    previousTrack?.stop();
    previousStream?.getTracks().forEach((track) => track.stop());
  } catch (error) {
    nextTrack.stop();
    nextStream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export async function setPreferredSpeakerDevice(deviceId: string | null) {
  savePreferredAudioOutputDeviceId(deviceId);

  if (!isSpeakerSelectionSupported()) {
    return;
  }

  await Promise.all(
    Array.from(remoteAudioElements.values()).map((audio) => applySpeakerDeviceToElement(audio, deviceId)),
  );
}

export async function resetPreferredAudioDevices() {
  savePreferredAudioInputDeviceId(null);
  savePreferredAudioOutputDeviceId(null);
  savePreferredCameraDeviceId(null);

  if (initializedForChannelId && sendTransport) {
    await setPreferredMicrophoneDevice(null);
    if (cameraEnabled) {
      await setPreferredCameraDevice(null);
    }
  }

  if (isSpeakerSelectionSupported()) {
    await Promise.all(
      Array.from(remoteAudioElements.values()).map((audio) => applySpeakerDeviceToElement(audio, null)),
    );
  }
}

async function handleMediaDeviceChange() {
  if (handlingDeviceChange) {
    return;
  }

  setHandlingDeviceChange(true);

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputIds = new Set(devices.filter((device) => device.kind === "audioinput").map((device) => device.deviceId));
    const outputIds = new Set(devices.filter((device) => device.kind === "audiooutput").map((device) => device.deviceId));
    const cameraIds = new Set(devices.filter((device) => device.kind === "videoinput").map((device) => device.deviceId));

    const selectedAudioInput = preferredAudioInputDeviceId();
    if (selectedAudioInput && !inputIds.has(selectedAudioInput)) {
      await setPreferredMicrophoneDevice(null).catch(() => undefined);
    }

    const selectedAudioOutput = preferredAudioOutputDeviceId();
    if (selectedAudioOutput && !outputIds.has(selectedAudioOutput)) {
      await setPreferredSpeakerDevice(null).catch(() => undefined);
    }

    const selectedCamera = preferredCameraDeviceId();
    if (selectedCamera && !cameraIds.has(selectedCamera)) {
      savePreferredCameraDeviceId(null);

      if (cameraEnabled && initializedForChannelId) {
        try {
          await setPreferredCameraDevice(null);
          setCameraError("Preferred camera disconnected. Switched to the system default camera.");
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : "Preferred camera disconnected. Unable to switch camera automatically.";
          setCameraError(errorMessage);
          stopAndReleaseCameraTracks();
        }
      } else {
        setCameraError("Preferred camera disconnected. Select another camera to re-enable video.");
      }

      notifyCameraStateSubscribers();
    }
  } finally {
    setHandlingDeviceChange(false);
  }
}

const onMediaDeviceChange = () => {
  void handleMediaDeviceChange();
};

export function registerDeviceChangeListener() {
  if (deviceChangeListenerRegistered || !navigator.mediaDevices) {
    return;
  }

  if (typeof navigator.mediaDevices.addEventListener === "function") {
    navigator.mediaDevices.addEventListener("devicechange", onMediaDeviceChange);
  } else {
    navigator.mediaDevices.ondevicechange = onMediaDeviceChange;
  }

  setDeviceChangeListenerRegistered(true);
}

export function unregisterDeviceChangeListener() {
  if (!deviceChangeListenerRegistered || !navigator.mediaDevices) {
    return;
  }

  if (typeof navigator.mediaDevices.removeEventListener === "function") {
    navigator.mediaDevices.removeEventListener("devicechange", onMediaDeviceChange);
  } else if (navigator.mediaDevices.ondevicechange === onMediaDeviceChange) {
    navigator.mediaDevices.ondevicechange = null;
  }

  setDeviceChangeListenerRegistered(false);
}

export function stopAndReleaseCameraTracks() {
  cameraProducer?.close();
  setCameraProducer(null);

  if (cameraTrack) {
    cameraTrack.stop();
    setCameraTrack(null);
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
  }

  setCameraEnabled(false);
  notifyCameraStateSubscribers();
}

export async function openCameraStreamWithFallback() {
  const preferredDeviceId = preferredCameraDeviceId();

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: cameraInputConstraint(preferredDeviceId),
    });
  } catch (error) {
    if (!preferredDeviceId || !isMissingDeviceError(error)) {
      throw error;
    }

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    });
  }
}
