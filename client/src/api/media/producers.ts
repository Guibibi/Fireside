import type { Producer } from "mediasoup-client/types";
import { voiceNoiseSuppressionEnabled, voiceOutgoingVolume } from "../../stores/settings";
import { audioInputConstraint } from "./constraints";
import { openCameraStreamWithFallback, stopAndReleaseCameraTracks } from "./devices";
import { normalizeCameraError } from "./errors";
import {
  activateMicrophoneProcessing,
  createProcessedMicrophoneTrack,
  disposeMicrophoneProcessingForTrack,
  disposePendingMicrophoneProcessing,
  type MicrophoneProcessingSession,
} from "./microphoneProcessing";
import { requestMediaSignal } from "./signaling";
import {
  cameraEnabled,
  cameraError,
  cameraProducer,
  cameraStream,
  cameraTrack,
  initializedForChannelId,
  micProducer,
  micStream,
  micTrack,
  microphoneMuted,
  sendTransport,
  setCameraEnabled,
  setCameraError,
  setCameraProducer,
  setCameraStream,
  setCameraTrack,
  setMicProducer,
  setMicStream,
  setMicTrack,
} from "./state";
import { notifyCameraStateSubscribers } from "./subscriptions";
import type { CameraActionResult } from "./types";
import { startMicLevelMonitoring, stopMicLevelMonitoring } from "./voiceActivity";

export async function startLocalAudioProducer(channelId: string) {
  if (!sendTransport || micProducer) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioInputConstraint(),
    video: false,
  });
  const [audioTrack] = stream.getAudioTracks();

  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Microphone track was not available");
  }

  let processingSession: MicrophoneProcessingSession;
  try {
    processingSession = await createProcessedMicrophoneTrack(
      stream,
      voiceOutgoingVolume(),
      microphoneMuted,
      voiceNoiseSuppressionEnabled(),
    );
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  setMicStream(stream);
  setMicTrack(processingSession.track);

  startMicLevelMonitoring(channelId, stream);

  let produced: Producer;
  try {
    produced = await sendTransport.produce({
      track: processingSession.track,
      stopTracks: false,
      appData: {
        source: "microphone",
        routingMode: "sfu",
      },
    });
  } catch (error) {
    disposePendingMicrophoneProcessing(processingSession);
    stopMicLevelMonitoring(channelId);
    stream.getTracks().forEach((track) => track.stop());
    if (micTrack === processingSession.track) {
      setMicTrack(null);
    }
    if (micStream === stream) {
      setMicStream(null);
    }
    throw error;
  }

  activateMicrophoneProcessing(processingSession);

  produced.on("transportclose", () => {
    setMicProducer(null);
  });

  produced.on("trackended", () => {
    setMicProducer(null);
  });

  setMicProducer(produced);

  if (initializedForChannelId !== channelId) {
    produced.close();
    setMicProducer(null);
    stopMicLevelMonitoring(channelId);
    const disposed = disposeMicrophoneProcessingForTrack(processingSession.track);
    if (!disposed) {
      disposePendingMicrophoneProcessing(processingSession);
    }
    stream.getTracks().forEach((track) => track.stop());
    if (micTrack === processingSession.track) {
      setMicTrack(null);
    }
    if (micStream === stream) {
      setMicStream(null);
    }
  }
}

export function localCameraStream(): MediaStream | null {
  return cameraStream;
}

export function localCameraEnabled(): boolean {
  return cameraEnabled;
}

export function localCameraError(): string | null {
  return cameraError;
}

export async function startLocalCameraProducer(channelId: string): Promise<CameraActionResult> {
  if (initializedForChannelId !== channelId || !sendTransport) {
    const message = "Join the voice channel before enabling camera";
    setCameraError(message);
    notifyCameraStateSubscribers();
    return { ok: false, error: message };
  }

  if (cameraProducer && cameraTrack && cameraEnabled) {
    setCameraError(null);
    notifyCameraStateSubscribers();
    return { ok: true };
  }

  let nextStream: MediaStream | null = null;
  let nextTrack: MediaStreamTrack | null = null;

  try {
    nextStream = await openCameraStreamWithFallback();

    [nextTrack] = nextStream.getVideoTracks();

    if (!nextTrack) {
      throw new Error("Camera track was not available");
    }

    const produced = await sendTransport.produce({
      track: nextTrack,
      stopTracks: false,
      appData: {
        source: "camera",
        routingMode: "sfu",
      },
    });

    produced.on("transportclose", () => {
      stopAndReleaseCameraTracks();
    });

    produced.on("trackended", () => {
      setCameraError("Camera stream ended. Check your camera device and re-enable camera.");
      stopAndReleaseCameraTracks();
      notifyCameraStateSubscribers();
    });

    if (initializedForChannelId !== channelId) {
      produced.close();
      nextTrack.stop();
      nextStream.getTracks().forEach((track) => track.stop());
      const message = "Voice channel changed while starting camera";
      setCameraError(message);
      notifyCameraStateSubscribers();
      return { ok: false, error: message };
    }

    stopAndReleaseCameraTracks();

    setCameraProducer(produced);
    setCameraStream(nextStream);
    setCameraTrack(nextTrack);
    setCameraEnabled(true);
    setCameraError(null);
    notifyCameraStateSubscribers();
    return { ok: true };
  } catch (error) {
    if (nextTrack) {
      nextTrack.stop();
    }

    if (nextStream) {
      nextStream.getTracks().forEach((track) => track.stop());
    }

    const message = normalizeCameraError(error);
    setCameraError(message);
    notifyCameraStateSubscribers();
    return { ok: false, error: message };
  }
}

export async function stopLocalCameraProducer(channelId: string): Promise<CameraActionResult> {
  const producerId = cameraProducer?.id;

  if (!producerId) {
    stopAndReleaseCameraTracks();
    setCameraError(null);
    notifyCameraStateSubscribers();
    return { ok: true };
  }

  try {
    const response = await requestMediaSignal(channelId, "media_close_producer", {
      producer_id: producerId,
      source: "camera",
      routing_mode: "sfu",
    });

    if (response.action !== "media_producer_closed") {
      throw new Error("Unexpected media_close_producer response from server");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop camera";
    setCameraError(message);
    notifyCameraStateSubscribers();
    return { ok: false, error: message };
  }

  stopAndReleaseCameraTracks();
  setCameraError(null);
  notifyCameraStateSubscribers();
  return { ok: true };
}
