import type { Producer, ProducerOptions } from "mediasoup-client/types";
import { nativeCaptureStatus } from "../nativeCapture";
import { isTauriRuntime } from "../../utils/platform";
import { audioInputConstraint, screenContentHintFor, screenShareVideoConstraints } from "./constraints";
import {
  codecMimeType,
  nativePreferredCodecsFor,
  selectScreenShareCodecForPlatform,
} from "./codecs";
import { openCameraStreamWithFallback, stopAndReleaseCameraTracks } from "./devices";
import { normalizeCameraError, normalizeScreenShareError } from "./errors";
import {
  armNativeCapture,
  clearNativeFallbackMonitor,
  disarmNativeCapture,
  readNativeSenderBackendStatus,
} from "./native";
import {
  reportCodecDecision,
  reportNativeSenderDiagnostic,
  requestMediaSignal,
} from "./signaling";
import {
  cameraEnabled,
  cameraProducer,
  cameraStream,
  cameraTrack,
  initializedForChannelId,
  micProducer,
  microphoneMuted,
  nativeCaptureAttempted,
  nativeScreenProducerId,
  screenEnabled,
  screenProducer,
  screenStream,
  screenTrack,
  sendTransport,
  setCameraEnabled,
  setCameraError,
  setCameraProducer,
  setCameraStream,
  setCameraTrack,
  setMicProducer,
  setMicStream,
  setMicTrack,
  setNativeCaptureAttempted,
  setNativeFallbackMonitorRunning,
  setNativeFallbackMonitorTimer,
  setNativeScreenProducerId,
  setScreenEnabled,
  setScreenError,
  setScreenProducer,
  setScreenRoutingMode,
  setScreenStream,
  setScreenTrack,
  nativeFallbackMonitorRunning,
} from "./state";
import { notifyCameraStateSubscribers, notifyScreenStateSubscribers } from "./subscriptions";
import type { CameraActionResult, ScreenShareStartOptions } from "./types";
import { startMicLevelMonitoring } from "./voiceActivity";

function readStringStatField(stat: RTCStats, field: string): string | null {
  const value = (stat as unknown as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function logScreenShareProducerStats(producer: Producer) {
  try {
    const stats = await producer.getStats();
    let outboundVideoStat: RTCStats | null = null;

    for (const stat of stats.values()) {
      if (stat.type !== "outbound-rtp") {
        continue;
      }

      const mediaType = readStringStatField(stat, "mediaType");
      const kind = readStringStatField(stat, "kind");
      if (mediaType !== "video" && kind !== "video") {
        continue;
      }

      outboundVideoStat = stat;
      break;
    }

    if (!outboundVideoStat) {
      console.debug("[media] Screen share sender stats unavailable for outbound video stream");
      return;
    }

    const codecId = readStringStatField(outboundVideoStat, "codecId");
    const encoderImplementation = readStringStatField(outboundVideoStat, "encoderImplementation");
    const codecStat = codecId ? stats.get(codecId) : undefined;
    const codecMimeTypeValue = codecStat && codecStat.type === "codec"
      ? readStringStatField(codecStat, "mimeType")
      : null;

    console.debug(
      "[media] Screen share sender stats",
      {
        codecMimeType: codecMimeTypeValue,
        encoderImplementation,
      },
    );
  } catch (error) {
    console.debug("[media] Failed to inspect screen share sender stats", error);
  }
}

export function stopAndReleaseScreenTracks() {
  screenProducer?.close();
  setScreenProducer(null);
  setNativeScreenProducerId(null);
  clearNativeFallbackMonitor();

  if (screenTrack) {
    screenTrack.stop();
    setScreenTrack(null);
  }

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
  }

  setScreenEnabled(false);
  setScreenRoutingMode(null);
  notifyScreenStateSubscribers();
}

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
    throw new Error("Microphone track was not available");
  }

  setMicStream(stream);
  setMicTrack(audioTrack);
  audioTrack.enabled = !microphoneMuted;

  startMicLevelMonitoring(channelId, stream);

  const produced = await sendTransport.produce({
    track: audioTrack,
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

  if (initializedForChannelId !== channelId) {
    produced.close();
    setMicProducer(null);
  }
}

export function localCameraStream(): MediaStream | null {
  return cameraStream;
}

export function localCameraEnabled(): boolean {
  return cameraEnabled;
}

export function localCameraError(): string | null {
  return cameraProducer ? null : (screenStream ? null : null);
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

export function localScreenShareStream(): MediaStream | null {
  return screenStream;
}

export function localScreenShareEnabled(): boolean {
  return screenEnabled;
}

export function localScreenShareError(): string | null {
  return screenProducer ? null : null;
}

async function closeNativeScreenProducer(channelId: string): Promise<void> {
  if (!nativeScreenProducerId) {
    return;
  }

  const producerId = nativeScreenProducerId;
  setNativeScreenProducerId(null);
  try {
    await requestMediaSignal(channelId, "media_close_producer", {
      producer_id: producerId,
      source: "screen",
      routing_mode: "sfu",
    });
  } catch {
    // best effort only
  }
}

export async function startBrowserScreenProducer(
  channelId: string,
  options?: ScreenShareStartOptions,
): Promise<CameraActionResult> {
  let nextStream: MediaStream | null = null;
  let nextTrack: MediaStreamTrack | null = null;

  try {
    const videoConstraint = options ? screenShareVideoConstraints(options) : true;
    nextStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraint,
      audio: false,
    });

    [nextTrack] = nextStream.getVideoTracks();
    if (!nextTrack) {
      throw new Error("Display track was not available");
    }

    if (options) {
      try {
        await nextTrack.applyConstraints(screenShareVideoConstraints(options));
      } catch {
        // best effort only
      }

      const hint = screenContentHintFor(options);
      if ("contentHint" in nextTrack) {
        nextTrack.contentHint = hint;
      }
    }

    const produceOptions: ProducerOptions = {
      track: nextTrack,
      stopTracks: false,
      appData: {
        source: "screen",
        routingMode: "sfu",
      },
    };

    // Always prefer H264 for maximum compatibility and NVENC hardware acceleration
    const preferredCodec = selectScreenShareCodecForPlatform();
    const codecNegotiated = preferredCodec
      ? (codecMimeType(preferredCodec) ?? "video/h264")
      : "runtime-default";

    reportCodecDecision(channelId, "video/h264", codecNegotiated, "none");

    if (preferredCodec) {
      produceOptions.codec = preferredCodec;
    }

    if (options) {
      produceOptions.encodings = [{
        maxBitrate: Math.round(options.bitrateKbps * 1000),
        maxFramerate: options.fps,
      }];
      produceOptions.codecOptions = {
        videoGoogleStartBitrate: Math.max(300, Math.round(options.bitrateKbps * 0.7)),
      };
    }

    const produced = await sendTransport!.produce(produceOptions);
    void logScreenShareProducerStats(produced);

    produced.on("transportclose", () => {
      stopAndReleaseScreenTracks();
    });

    produced.on("trackended", () => {
      if (initializedForChannelId) {
        void stopLocalScreenProducer(initializedForChannelId);
      } else {
        stopAndReleaseScreenTracks();
      }
    });

    if (initializedForChannelId !== channelId) {
      produced.close();
      nextTrack.stop();
      nextStream.getTracks().forEach((track) => track.stop());
      const message = "Voice channel changed while starting screen share";
      setScreenError(message);
      notifyScreenStateSubscribers();
      return { ok: false, error: message };
    }

    stopAndReleaseScreenTracks();
    setScreenProducer(produced);
    setScreenStream(nextStream);
    setScreenTrack(nextTrack);
    setScreenEnabled(true);
    setScreenError(null);
    setScreenRoutingMode("sfu");
    notifyScreenStateSubscribers();
    return { ok: true };
  } catch (error) {
    if (nextTrack) {
      nextTrack.stop();
    }
    if (nextStream) {
      nextStream.getTracks().forEach((track) => track.stop());
    }

    const message = normalizeScreenShareError(error);
    setScreenError(message);
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }
}

async function startNativeScreenProducer(
  channelId: string,
  options: ScreenShareStartOptions,
): Promise<CameraActionResult> {
  // Always use H264 for native capture - universal hardware decode support
  const response = await requestMediaSignal(channelId, "create_native_sender_session", {
    preferred_codecs: nativePreferredCodecsFor(),
  });
  if (
    response.action !== "native_sender_session_created"
    || !response.producer_id
    || !response.rtp_target
    || typeof response.payload_type !== "number"
    || typeof response.ssrc !== "number"
  ) {
    throw new Error("Unexpected native sender setup response from server");
  }

  try {
    if (!Number.isInteger(response.payload_type) || response.payload_type < 0 || response.payload_type > 127) {
      reportNativeSenderDiagnostic(
        channelId,
        "native_sender_invalid_payload_type",
        `payload_type=${String(response.payload_type)}`,
      );
      throw new Error(`Native sender negotiation failed: invalid RTP payload type (${response.payload_type}).`);
    }

    if (!Number.isInteger(response.ssrc) || response.ssrc <= 0 || response.ssrc > 0xFFFF_FFFF) {
      reportNativeSenderDiagnostic(
        channelId,
        "native_sender_invalid_ssrc",
        `ssrc=${String(response.ssrc)}`,
      );
      throw new Error(`Native sender negotiation failed: invalid RTP SSRC (${response.ssrc}).`);
    }

    const negotiatedMimeType = response.codec?.mime_type ?? response.mime_type;
    if (typeof negotiatedMimeType !== "string" || negotiatedMimeType.trim().length === 0) {
      reportCodecDecision(channelId, "video/h264", "unknown", "missing_codec_metadata");
      reportNativeSenderDiagnostic(
        channelId,
        "native_sender_codec_missing",
        "negotiated codec mime type missing",
      );
      throw new Error("Native sender negotiation failed: codec metadata missing.");
    }

    const negotiatedMimeTypeNormalized = negotiatedMimeType.toLowerCase();
    if (
      negotiatedMimeTypeNormalized !== "video/h264"
      && negotiatedMimeTypeNormalized !== "video/vp8"
      && negotiatedMimeTypeNormalized !== "video/vp9"
      && negotiatedMimeTypeNormalized !== "video/av1"
    ) {
      reportCodecDecision(channelId, "video/h264", negotiatedMimeType, "unsupported_codec");
      reportNativeSenderDiagnostic(
        channelId,
        "native_sender_unsupported_codec",
        `mime_type=${negotiatedMimeType}`,
      );
      throw new Error(`Native sender negotiation failed: unsupported codec (${negotiatedMimeType}).`);
    }

    reportCodecDecision(channelId, "video/h264", negotiatedMimeTypeNormalized, "none");

    const advertisedCodecSummary = Array.isArray(response.available_codecs)
      ? response.available_codecs
        .map((codec) => {
          const mimeType = typeof codec.mime_type === "string" ? codec.mime_type : "unknown";
          const readiness = typeof codec.readiness === "string" ? codec.readiness : "unknown";
          return `${mimeType}:${readiness}`;
        })
        .join(",")
      : "none";
    reportNativeSenderDiagnostic(
      channelId,
      "native_sender_codec_catalog",
      `selected=${negotiatedMimeType};available=${advertisedCodecSummary}`,
    );

    await armNativeCapture(
      options,
      negotiatedMimeType,
      response.rtp_target,
      response.payload_type,
      response.ssrc,
    );
    const backendStatus = await readNativeSenderBackendStatus();
    reportNativeSenderDiagnostic(
      channelId,
      "native_sender_started",
      `encoder_backend=${backendStatus.backend};requested_backend=${backendStatus.requestedBackend};backend_fallback_reason=${backendStatus.fallbackReason}`,
    );
  } catch (error) {
    await requestMediaSignal(channelId, "media_close_producer", {
      producer_id: response.producer_id,
      source: "screen",
      routing_mode: "sfu",
    }).catch(() => undefined);
    throw error;
  }

  stopAndReleaseScreenTracks();
  setNativeScreenProducerId(response.producer_id);
  setScreenEnabled(true);
  setScreenError(null);
  setScreenRoutingMode("sfu");
  notifyScreenStateSubscribers();

  clearNativeFallbackMonitor();
  const timer = window.setInterval(() => {
    if (nativeFallbackMonitorRunning || !nativeScreenProducerId || !screenEnabled) {
      return;
    }

    setNativeFallbackMonitorRunning(true);
    void (async () => {
      try {
        const status = await nativeCaptureStatus();
        const fallbackReason = status.native_sender.recent_fallback_reason;
        if (status.native_sender.worker_active || !fallbackReason) {
          return;
        }

        const backend = status.native_sender.encoder_backend ?? "unknown";
        const requestedBackend = status.native_sender.encoder_backend_requested ?? "unknown";
        const backendFallbackReason = status.native_sender.encoder_backend_fallback_reason ?? "none";
        const degradation = status.native_sender.degradation_level;
        reportNativeSenderDiagnostic(
          channelId,
          "native_sender_runtime_error",
          `reason=${fallbackReason};encoder_backend=${backend};requested_backend=${requestedBackend};backend_fallback_reason=${backendFallbackReason};degradation=${degradation}`,
        );

        await closeNativeScreenProducer(channelId);
        await disarmNativeCapture();
        stopAndReleaseScreenTracks();

        setScreenError(`Native screen capture failed: ${fallbackReason}`);
        notifyScreenStateSubscribers();
      } catch {
        // best effort monitor
      } finally {
        setNativeFallbackMonitorRunning(false);
      }
    })();
  }, 1000);
  setNativeFallbackMonitorTimer(timer);

  return { ok: true };
}

export async function startLocalScreenProducer(
  channelId: string,
  options?: ScreenShareStartOptions,
): Promise<CameraActionResult> {
  if (initializedForChannelId !== channelId || !sendTransport) {
    const message = "Join the voice channel before sharing your screen";
    setScreenError(message);
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }

  if ((screenProducer && screenTrack && screenEnabled) || (nativeScreenProducerId && screenEnabled)) {
    setScreenError(null);
    setScreenRoutingMode("sfu");
    notifyScreenStateSubscribers();
    return { ok: true };
  }

  if (isTauriRuntime() && options?.sourceId) {
    setNativeCaptureAttempted(true);
    try {
      return await startNativeScreenProducer(channelId, options);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Native screen capture failed.";
      console.error("[media] Native screen capture failed", error);
      await disarmNativeCapture();
      setScreenError(message);
      notifyScreenStateSubscribers();
      return { ok: false, error: message };
    }
  }

  // Never fall back to browser if native capture was attempted in this session
  if (nativeCaptureAttempted) {
    const message = "Native screen capture required. Please select a source from the native picker.";
    setScreenError(message);
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }

  return startBrowserScreenProducer(channelId, options);
}

export async function stopLocalScreenProducer(channelId: string): Promise<CameraActionResult> {
  const producerId = screenProducer?.id ?? nativeScreenProducerId;

  // Reset native capture flag when user explicitly stops screen sharing
  setNativeCaptureAttempted(false);

  if (!producerId) {
    stopAndReleaseScreenTracks();
    await disarmNativeCapture();
    setScreenError(null);
    notifyScreenStateSubscribers();
    return { ok: true };
  }

  try {
    const response = await requestMediaSignal(channelId, "media_close_producer", {
      producer_id: producerId,
      source: "screen",
      routing_mode: "sfu",
    });

    if (response.action !== "media_producer_closed") {
      throw new Error("Unexpected media_close_producer response from server");
    }
  } catch (error) {
    await disarmNativeCapture();

    const message = error instanceof Error ? error.message : "Failed to stop screen sharing";

    const hasEndedTrack = screenTrack?.readyState === "ended";
    const streamInactive = screenStream ? !screenStream.active : false;
    if (hasEndedTrack || streamInactive) {
      stopAndReleaseScreenTracks();
    }

    setScreenError(message);
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }

  stopAndReleaseScreenTracks();
  setNativeScreenProducerId(null);
  await disarmNativeCapture();
  setScreenError(null);
  notifyScreenStateSubscribers();
  return { ok: true };
}
