import { Device } from "mediasoup-client";
import type { Consumer, Producer, Transport } from "mediasoup-client/types";
import { onMessage, send } from "./ws";
import {
  preferredAudioInputDeviceId,
  preferredAudioOutputDeviceId,
  savePreferredAudioInputDeviceId,
  savePreferredAudioOutputDeviceId,
} from "../stores/settings";

interface IceParameters {
  usernameFragment: string;
  password: string;
  iceLite?: boolean;
}

interface IceCandidate {
  foundation: string;
  priority: number;
  address: string;
  ip: string;
  protocol: "udp" | "tcp";
  port: number;
  type: "host" | "srflx" | "prflx" | "relay";
  tcpType?: "active" | "passive" | "so";
}

interface DtlsParameters {
  role?: "auto" | "client" | "server";
  fingerprints: Array<{
    algorithm: "sha-1" | "sha-224" | "sha-256" | "sha-384" | "sha-512";
    value: string;
  }>;
}

interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

type MediaSignalAction =
  | "router_rtp_capabilities"
  | "webrtc_transport_created"
  | "webrtc_transport_connected"
  | "media_produced"
  | "media_producer_closed"
  | "new_producer"
  | "media_consumer_created"
  | "media_consumer_resumed"
  | "producer_closed"
  | "signal_error";

type MediaKind = "audio" | "video";
type MediaSource = "microphone" | "camera" | "screen";
export type RoutingMode = "sfu";

interface MediaConsumerDescription {
  id: string;
  producer_id: string;
  kind: MediaKind;
  rtp_parameters: unknown;
}

interface MediaSignalPayload {
  action?: MediaSignalAction | string;
  request_id?: string;
  message?: string;
  rtp_capabilities?: unknown;
  transport?: {
    id: string;
    ice_parameters: IceParameters;
    ice_candidates: IceCandidate[];
    dtls_parameters: DtlsParameters;
  };
  transport_id?: string;
  direction?: "send" | "recv";
  producer_id?: string;
  username?: string;
  kind?: MediaKind;
  source?: MediaSource;
  routing_mode?: RoutingMode;
  consumer?: MediaConsumerDescription;
  consumer_id?: string;
}

interface PendingRequest {
  resolve: (payload: MediaSignalPayload) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface AudioDeviceOption {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}

export interface AudioDeviceInventory {
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
}

export interface CameraActionResult {
  ok: boolean;
  error?: string;
}

export interface CameraStateSnapshot {
  enabled: boolean;
  error: string | null;
  stream: MediaStream | null;
}

export interface ScreenShareStateSnapshot {
  enabled: boolean;
  error: string | null;
  stream: MediaStream | null;
  routingMode: RoutingMode | null;
}

export interface RemoteVideoTile {
  producerId: string;
  username: string;
  stream: MediaStream;
  source: "camera" | "screen";
  routingMode: RoutingMode;
}

interface QueuedProducerAnnouncement {
  kind?: MediaKind;
  source?: MediaSource;
  routingMode?: RoutingMode;
  username?: string;
}

type SinkableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

let device: Device | null = null;
let sendTransport: Transport | null = null;
let recvTransport: Transport | null = null;
let micProducer: Producer | null = null;
let micStream: MediaStream | null = null;
let micTrack: MediaStreamTrack | null = null;
let cameraProducer: Producer | null = null;
let cameraStream: MediaStream | null = null;
let cameraTrack: MediaStreamTrack | null = null;
let cameraEnabled = false;
let cameraError: string | null = null;
let screenProducer: Producer | null = null;
let screenStream: MediaStream | null = null;
let screenTrack: MediaStreamTrack | null = null;
let screenEnabled = false;
let screenError: string | null = null;
let screenRoutingMode: RoutingMode | null = null;
let initializedForChannelId: string | null = null;
let initializingForChannelId: string | null = null;
let initializePromise: Promise<void> | null = null;
let signalListenerInitialized = false;
let requestCounter = 0;
let microphoneMuted = false;
let speakersMuted = false;
let micLevelAudioContext: AudioContext | null = null;
let micLevelSourceNode: MediaStreamAudioSourceNode | null = null;
let micLevelAnalyserNode: AnalyserNode | null = null;
let micLevelData: Uint8Array | null = null;
let micLevelMonitorFrame: number | null = null;
let micSpeakingHoldUntil = 0;
let micSpeakingLastSent = false;

const remoteConsumers = new Map<string, Consumer>();
const consumerIdByProducerId = new Map<string, string>();
const remoteAudioElements = new Map<string, HTMLAudioElement>();
const queuedProducerAnnouncements = new Map<string, QueuedProducerAnnouncement>();
const producerUsernameById = new Map<string, string>();
const producerSourceById = new Map<string, MediaSource>();
const producerRoutingModeById = new Map<string, RoutingMode>();
const remoteVideoTilesByProducerId = new Map<string, RemoteVideoTile>();
const videoTilesSubscribers = new Set<(tiles: RemoteVideoTile[]) => void>();
const cameraStateSubscribers = new Set<(snapshot: CameraStateSnapshot) => void>();
const screenStateSubscribers = new Set<(snapshot: ScreenShareStateSnapshot) => void>();

const pendingRequests = new Map<string, PendingRequest>();

function videoTilesSnapshot(): RemoteVideoTile[] {
  return Array.from(remoteVideoTilesByProducerId.values()).sort((left, right) => {
    const userOrder = left.username.localeCompare(right.username);
    if (userOrder !== 0) {
      return userOrder;
    }

    return left.producerId.localeCompare(right.producerId);
  });
}

function notifyVideoTilesSubscribers() {
  const snapshot = videoTilesSnapshot();
  for (const subscriber of videoTilesSubscribers) {
    subscriber(snapshot);
  }
}

function cameraStateSnapshot(): CameraStateSnapshot {
  return {
    enabled: cameraEnabled,
    error: cameraError,
    stream: cameraStream,
  };
}

function notifyCameraStateSubscribers() {
  const snapshot = cameraStateSnapshot();
  for (const subscriber of cameraStateSubscribers) {
    subscriber(snapshot);
  }
}

function screenStateSnapshot(): ScreenShareStateSnapshot {
  return {
    enabled: screenEnabled,
    error: screenError,
    stream: screenStream,
    routingMode: screenRoutingMode,
  };
}

function notifyScreenStateSubscribers() {
  const snapshot = screenStateSnapshot();
  for (const subscriber of screenStateSubscribers) {
    subscriber(snapshot);
  }
}

function clearRemoteVideoTiles() {
  if (remoteVideoTilesByProducerId.size === 0) {
    return;
  }

  remoteVideoTilesByProducerId.clear();
  notifyVideoTilesSubscribers();
}

export function remoteVideoTiles(): RemoteVideoTile[] {
  return videoTilesSnapshot();
}

export function subscribeVideoTiles(subscriber: (tiles: RemoteVideoTile[]) => void): () => void {
  videoTilesSubscribers.add(subscriber);
  subscriber(videoTilesSnapshot());

  return () => {
    videoTilesSubscribers.delete(subscriber);
  };
}

export function subscribeCameraState(subscriber: (snapshot: CameraStateSnapshot) => void): () => void {
  cameraStateSubscribers.add(subscriber);
  subscriber(cameraStateSnapshot());

  return () => {
    cameraStateSubscribers.delete(subscriber);
  };
}

export function subscribeScreenState(subscriber: (snapshot: ScreenShareStateSnapshot) => void): () => void {
  screenStateSubscribers.add(subscriber);
  subscriber(screenStateSnapshot());

  return () => {
    screenStateSubscribers.delete(subscriber);
  };
}

function reportVoiceActivity(channelId: string, speaking: boolean) {
  if (micSpeakingLastSent === speaking) {
    return;
  }

  micSpeakingLastSent = speaking;
  send({
    type: "voice_activity",
    channel_id: channelId,
    speaking,
  });
}

function stopMicLevelMonitoring(channelId: string | null) {
  if (micLevelMonitorFrame !== null) {
    cancelAnimationFrame(micLevelMonitorFrame);
    micLevelMonitorFrame = null;
  }

  micSpeakingHoldUntil = 0;

  if (channelId && micSpeakingLastSent) {
    reportVoiceActivity(channelId, false);
  }

  micLevelSourceNode?.disconnect();
  micLevelSourceNode = null;
  micLevelAnalyserNode?.disconnect();
  micLevelAnalyserNode = null;
  micLevelData = null;

  if (micLevelAudioContext) {
    void micLevelAudioContext.close().catch(() => undefined);
    micLevelAudioContext = null;
  }

  micSpeakingLastSent = false;
}

function startMicLevelMonitoring(channelId: string, stream: MediaStream) {
  stopMicLevelMonitoring(initializedForChannelId ?? channelId);

  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();

  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.85;
  sourceNode.connect(analyserNode);

  const data = new Uint8Array(analyserNode.frequencyBinCount);

  micLevelAudioContext = audioContext;
  micLevelSourceNode = sourceNode;
  micLevelAnalyserNode = analyserNode;
  micLevelData = data;
  micSpeakingHoldUntil = 0;
  micSpeakingLastSent = false;

  const levelThreshold = 0.04;
  const speakingHoldMs = 220;

  const monitor = () => {
    if (!micLevelAnalyserNode || !micLevelData || initializedForChannelId !== channelId) {
      return;
    }

    micLevelAnalyserNode.getByteTimeDomainData(micLevelData);

    let sum = 0;
    for (let i = 0; i < micLevelData.length; i += 1) {
      const normalized = (micLevelData[i] - 128) / 128;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / micLevelData.length);
    const now = performance.now();

    if (rms >= levelThreshold && !microphoneMuted) {
      micSpeakingHoldUntil = now + speakingHoldMs;
    }

    const speaking = !microphoneMuted && now <= micSpeakingHoldUntil;
    reportVoiceActivity(channelId, speaking);

    micLevelMonitorFrame = requestAnimationFrame(monitor);
  };

  micLevelMonitorFrame = requestAnimationFrame(monitor);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toMediaSignalPayload(value: unknown): MediaSignalPayload | null {
  if (!isObject(value)) {
    return null;
  }

  return value as MediaSignalPayload;
}

function nextRequestId() {
  requestCounter += 1;
  return `media-${Date.now()}-${requestCounter}`;
}

function ensureSignalListener() {
  if (signalListenerInitialized) {
    return;
  }

  signalListenerInitialized = true;
  onMessage((msg) => {
    if (msg.type !== "media_signal") {
      return;
    }

    const payload = toMediaSignalPayload(msg.payload);
    if (!payload) {
      return;
    }

    if (payload.request_id) {
      const pending = pendingRequests.get(payload.request_id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      pendingRequests.delete(payload.request_id);

      if (payload.action === "signal_error") {
        pending.reject(new Error(payload.message ?? "Media signaling request failed"));
        return;
      }

      pending.resolve(payload);
      return;
    }

    if (msg.channel_id !== initializedForChannelId && msg.channel_id !== initializingForChannelId) {
      return;
    }

    if (payload.action === "new_producer" && payload.producer_id) {
      if (payload.username) {
        producerUsernameById.set(payload.producer_id, payload.username);
      }
      if (payload.source) {
        producerSourceById.set(payload.producer_id, payload.source);
      }
      if (payload.routing_mode) {
        producerRoutingModeById.set(payload.producer_id, payload.routing_mode);
      }
      queueOrConsumeProducer(
        msg.channel_id,
        payload.producer_id,
        payload.kind,
        payload.source,
        payload.routing_mode,
        payload.username,
      );
      return;
    }

    if (payload.action === "producer_closed" && payload.producer_id) {
      producerUsernameById.delete(payload.producer_id);
      producerSourceById.delete(payload.producer_id);
      producerRoutingModeById.delete(payload.producer_id);
      if (remoteVideoTilesByProducerId.delete(payload.producer_id)) {
        notifyVideoTilesSubscribers();
      }
      const consumerId = consumerIdByProducerId.get(payload.producer_id);
      if (consumerId) {
        disposeRemoteConsumer(consumerId);
      }
    }
  });
}

function requestMediaSignal(channelId: string, action: string, extra: Record<string, unknown> = {}) {
  ensureSignalListener();

  const requestId = nextRequestId();

  return new Promise<MediaSignalPayload>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timed out waiting for media signaling response: ${action}`));
    }, 10000);

    pendingRequests.set(requestId, { resolve, reject, timeoutId });

    send({
      type: "media_signal",
      channel_id: channelId,
      payload: {
        action,
        request_id: requestId,
        ...extra,
      },
    });
  });
}

function closeTransports() {
  stopMicLevelMonitoring(initializedForChannelId);

  micProducer?.close();
  micProducer = null;

  if (micTrack) {
    micTrack.stop();
    micTrack = null;
  }

  if (micStream) {
    for (const track of micStream.getTracks()) {
      track.stop();
    }
    micStream = null;
  }

  cameraProducer?.close();
  cameraProducer = null;

  if (cameraTrack) {
    cameraTrack.stop();
    cameraTrack = null;
  }

  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
  }
  cameraEnabled = false;
  cameraError = null;
  notifyCameraStateSubscribers();

  screenProducer?.close();
  screenProducer = null;

  if (screenTrack) {
    screenTrack.stop();
    screenTrack = null;
  }

  if (screenStream) {
    for (const track of screenStream.getTracks()) {
      track.stop();
    }
    screenStream = null;
  }
  screenEnabled = false;
  screenError = null;
  screenRoutingMode = null;
  notifyScreenStateSubscribers();

  for (const consumerId of remoteConsumers.keys()) {
    disposeRemoteConsumer(consumerId);
  }

  sendTransport?.close();
  recvTransport?.close();
  sendTransport = null;
  recvTransport = null;
  device = null;
  initializedForChannelId = null;
  initializingForChannelId = null;
  queuedProducerAnnouncements.clear();
  producerUsernameById.clear();
  producerSourceById.clear();
  producerRoutingModeById.clear();
  clearRemoteVideoTiles();
}

function normalizeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError"
      || error.name === "PermissionDeniedError"
      || error.name === "SecurityError"
    ) {
      return "Camera access was denied. Please allow camera permission and try again.";
    }

    if (
      error.name === "NotFoundError"
      || error.name === "DevicesNotFoundError"
      || error.name === "OverconstrainedError"
    ) {
      return "No camera device was found. Connect a camera and try again.";
    }

    if (
      error.name === "NotReadableError"
      || error.name === "TrackStartError"
      || error.name === "AbortError"
    ) {
      return "Camera is unavailable or in use by another app.";
    }
  }

  return error instanceof Error ? error.message : "Failed to start camera";
}

function normalizeScreenShareError(error: unknown): string {
  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError"
      || error.name === "PermissionDeniedError"
      || error.name === "SecurityError"
    ) {
      return "Screen share permission was denied.";
    }

    if (
      error.name === "NotFoundError"
      || error.name === "DevicesNotFoundError"
      || error.name === "OverconstrainedError"
    ) {
      return "No shareable display source was found.";
    }

    if (
      error.name === "NotReadableError"
      || error.name === "TrackStartError"
      || error.name === "AbortError"
    ) {
      return "Screen sharing is unavailable or already in use.";
    }
  }

  return error instanceof Error ? error.message : "Failed to start screen sharing";
}

function stopAndReleaseCameraTracks() {
  cameraProducer?.close();
  cameraProducer = null;

  if (cameraTrack) {
    cameraTrack.stop();
    cameraTrack = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  cameraEnabled = false;
  notifyCameraStateSubscribers();
}

function stopAndReleaseScreenTracks() {
  screenProducer?.close();
  screenProducer = null;

  if (screenTrack) {
    screenTrack.stop();
    screenTrack = null;
  }

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  screenEnabled = false;
  screenRoutingMode = null;
  notifyScreenStateSubscribers();
}

function toTransportOptions(payload: MediaSignalPayload): TransportOptions {
  const transport = payload.transport;
  if (!transport) {
    throw new Error("Missing transport payload from server");
  }

  return {
    id: transport.id,
    iceParameters: transport.ice_parameters,
    iceCandidates: transport.ice_candidates,
    dtlsParameters: transport.dtls_parameters,
  };
}

function wireTransportConnect(channelId: string, transport: Transport) {
  transport.on("connect", ({ dtlsParameters }, callback, errback) => {
    requestMediaSignal(channelId, "connect_webrtc_transport", {
      transport_id: transport.id,
      dtls_parameters: dtlsParameters,
    })
      .then(() => callback())
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error("Failed to connect transport");
        errback(normalized);
      });
  });
}

function wireSendTransportProduce(channelId: string, transport: Transport) {
  transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
    const appDataSource = isObject(appData) && typeof appData.source === "string"
      ? appData.source
      : undefined;
    const appDataRoutingMode = isObject(appData) && typeof appData.routingMode === "string"
      ? appData.routingMode
      : undefined;

    requestMediaSignal(channelId, "media_produce", {
      kind,
      rtp_parameters: rtpParameters,
      source: appDataSource,
      routing_mode: appDataRoutingMode,
    })
      .then((response) => {
        if (response.action !== "media_produced" || !response.producer_id) {
          throw new Error("Unexpected media_produce response from server");
        }

        callback({ id: response.producer_id });
      })
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error("Failed to produce track");
        errback(normalized);
      });
  });
}

function audioInputConstraint(deviceId: string | null = preferredAudioInputDeviceId()): MediaTrackConstraints | boolean {
  const selectedDeviceId = deviceId;
  if (!selectedDeviceId) {
    return true;
  }

  return {
    deviceId: { exact: selectedDeviceId },
  };
}

async function startLocalAudioProducer(channelId: string) {
  if (!sendTransport || micProducer) {
    return;
  }

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: audioInputConstraint(),
    video: false,
  });
  const [audioTrack] = micStream.getAudioTracks();

  if (!audioTrack) {
    throw new Error("Microphone track was not available");
  }

  micTrack = audioTrack;
  micTrack.enabled = !microphoneMuted;

  startMicLevelMonitoring(channelId, micStream);

  const produced = await sendTransport.produce({
    track: micTrack,
    stopTracks: false,
    appData: {
      source: "microphone",
      routingMode: "sfu",
    },
  });

  produced.on("transportclose", () => {
    micProducer = null;
  });

  produced.on("trackended", () => {
    micProducer = null;
  });

  micProducer = produced;

  if (initializedForChannelId !== channelId) {
    micProducer.close();
    micProducer = null;
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
    cameraError = message;
    notifyCameraStateSubscribers();
    return { ok: false, error: message };
  }

  if (cameraProducer && cameraTrack && cameraEnabled) {
    cameraError = null;
    notifyCameraStateSubscribers();
    return { ok: true };
  }

  let nextStream: MediaStream | null = null;
  let nextTrack: MediaStreamTrack | null = null;

  try {
    nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    });

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
      stopAndReleaseCameraTracks();
    });

    if (initializedForChannelId !== channelId) {
      produced.close();
      nextTrack.stop();
      nextStream.getTracks().forEach((track) => track.stop());
      const message = "Voice channel changed while starting camera";
      cameraError = message;
      notifyCameraStateSubscribers();
      return { ok: false, error: message };
    }

    stopAndReleaseCameraTracks();

    cameraProducer = produced;
    cameraStream = nextStream;
    cameraTrack = nextTrack;
    cameraEnabled = true;
    cameraError = null;
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
    cameraError = message;
    notifyCameraStateSubscribers();
    return { ok: false, error: message };
  }
}

export async function stopLocalCameraProducer(channelId: string): Promise<CameraActionResult> {
  const producerId = cameraProducer?.id;

  if (!producerId) {
    stopAndReleaseCameraTracks();
    cameraError = null;
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
    cameraError = message;
    notifyCameraStateSubscribers();
    return { ok: false, error: message };
  }

  stopAndReleaseCameraTracks();
  cameraError = null;
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
  return screenError;
}

export async function startLocalScreenProducer(channelId: string): Promise<CameraActionResult> {
  if (initializedForChannelId !== channelId || !sendTransport) {
    const message = "Join the voice channel before sharing your screen";
    screenError = message;
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }

  if (screenProducer && screenTrack && screenEnabled) {
    screenError = null;
    screenRoutingMode = "sfu";
    notifyScreenStateSubscribers();
    return { ok: true };
  }

  let nextStream: MediaStream | null = null;
  let nextTrack: MediaStreamTrack | null = null;

  try {
    nextStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    [nextTrack] = nextStream.getVideoTracks();

    if (!nextTrack) {
      throw new Error("Display track was not available");
    }

    const produced = await sendTransport.produce({
      track: nextTrack,
      stopTracks: false,
      appData: {
        source: "screen",
        routingMode: "sfu",
      },
    });

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
      screenError = message;
      notifyScreenStateSubscribers();
      return { ok: false, error: message };
    }

    stopAndReleaseScreenTracks();

    screenProducer = produced;
    screenStream = nextStream;
    screenTrack = nextTrack;
    screenEnabled = true;
    screenError = null;
    screenRoutingMode = "sfu";
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
    screenError = message;
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }
}

export async function stopLocalScreenProducer(channelId: string): Promise<CameraActionResult> {
  const producerId = screenProducer?.id;

  if (!producerId) {
    stopAndReleaseScreenTracks();
    screenError = null;
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
    const message = error instanceof Error ? error.message : "Failed to stop screen sharing";

    const hasEndedTrack = screenTrack?.readyState === "ended";
    const streamInactive = screenStream ? !screenStream.active : false;
    if (hasEndedTrack || streamInactive) {
      stopAndReleaseScreenTracks();
    }

    screenError = message;
    notifyScreenStateSubscribers();
    return { ok: false, error: message };
  }

  stopAndReleaseScreenTracks();
  screenError = null;
  notifyScreenStateSubscribers();
  return { ok: true };
}

function ensureAudioElement(consumerId: string): HTMLAudioElement {
  const existing = remoteAudioElements.get(consumerId);
  if (existing) {
    return existing;
  }

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.muted = speakersMuted;
  audio.style.display = "none";
  document.body.appendChild(audio);

  const sinkTarget = preferredAudioOutputDeviceId();
  if (sinkTarget && isSpeakerSelectionSupported()) {
    const sinkable = audio as SinkableAudioElement;
    void sinkable.setSinkId?.(sinkTarget).catch(() => undefined);
  }

  remoteAudioElements.set(consumerId, audio);
  return audio;
}

function disposeRemoteConsumer(consumerId: string) {
  const consumer = remoteConsumers.get(consumerId);
  if (consumer) {
    const producerId = consumer.producerId;
    consumer.close();
    remoteConsumers.delete(consumerId);
    if (producerId) {
      consumerIdByProducerId.delete(producerId);
      producerSourceById.delete(producerId);
      producerRoutingModeById.delete(producerId);
      producerUsernameById.delete(producerId);
      if (remoteVideoTilesByProducerId.delete(producerId)) {
        notifyVideoTilesSubscribers();
      }
    }
  }

  const audio = remoteAudioElements.get(consumerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(consumerId);
  }
}

async function consumeRemoteProducer(channelId: string, producerId: string) {
  if (!device || !recvTransport || initializedForChannelId !== channelId) {
    queuedProducerAnnouncements.set(producerId, {
      kind: undefined,
      source: producerSourceById.get(producerId),
      routingMode: producerRoutingModeById.get(producerId),
      username: producerUsernameById.get(producerId),
    });
    return;
  }

  if (consumerIdByProducerId.has(producerId)) {
    return;
  }

  const response = await requestMediaSignal(channelId, "media_consume", {
    producer_id: producerId,
    rtp_capabilities: device.rtpCapabilities,
  });

  if (response.action !== "media_consumer_created" || !response.consumer) {
    throw new Error("Unexpected media_consume response from server");
  }

  const description = response.consumer;

  const consumer = await recvTransport.consume({
    id: description.id,
    producerId: description.producer_id,
    kind: description.kind,
    rtpParameters: description.rtp_parameters as Parameters<Transport["consume"]>[0]["rtpParameters"],
  });

  consumerIdByProducerId.set(description.producer_id, consumer.id);
  remoteConsumers.set(consumer.id, consumer);

  consumer.on("transportclose", () => {
    disposeRemoteConsumer(consumer.id);
  });

  consumer.on("trackended", () => {
    disposeRemoteConsumer(consumer.id);
  });

  if (description.kind === "audio") {
    const audio = ensureAudioElement(consumer.id);
    audio.srcObject = new MediaStream([consumer.track]);
    void audio.play().catch(() => undefined);
  } else {
    const username = producerUsernameById.get(description.producer_id) ?? "Unknown";
    const source = producerSourceById.get(description.producer_id) === "screen" ? "screen" : "camera";
    const routingMode = producerRoutingModeById.get(description.producer_id) ?? "sfu";
    remoteVideoTilesByProducerId.set(description.producer_id, {
      producerId: description.producer_id,
      username,
      stream: new MediaStream([consumer.track]),
      source,
      routingMode,
    });
    notifyVideoTilesSubscribers();
  }

  try {
    await requestMediaSignal(channelId, "media_resume_consumer", {
      consumer_id: consumer.id,
    });
  } catch (error) {
    disposeRemoteConsumer(consumer.id);
    throw error;
  }
}

function queueOrConsumeProducer(
  channelId: string,
  producerId: string,
  kind: MediaKind | undefined,
  source: MediaSource | undefined,
  routingMode: RoutingMode | undefined,
  username?: string,
) {
  if (username) {
    producerUsernameById.set(producerId, username);
  }

  if (source) {
    producerSourceById.set(producerId, source);
  }

  if (routingMode) {
    producerRoutingModeById.set(producerId, routingMode);
  }

  if (consumerIdByProducerId.has(producerId)) {
    return;
  }

  if (!device || !recvTransport || initializedForChannelId !== channelId) {
    queuedProducerAnnouncements.set(producerId, { kind, source, routingMode, username });
    return;
  }

  void consumeRemoteProducer(channelId, producerId).catch(() => {
    queuedProducerAnnouncements.set(producerId, { kind, source, routingMode, username });
  });
}

function flushQueuedProducerAnnouncements(channelId: string) {
  const queuedProducerEntries = Array.from(queuedProducerAnnouncements.entries());
  queuedProducerAnnouncements.clear();

  for (const [producerId, queued] of queuedProducerEntries) {
    if (queued.username) {
      producerUsernameById.set(producerId, queued.username);
    }

    if (queued.source) {
      producerSourceById.set(producerId, queued.source);
    }

    if (queued.routingMode) {
      producerRoutingModeById.set(producerId, queued.routingMode);
    }

    void consumeRemoteProducer(channelId, producerId).catch(() => {
      queuedProducerAnnouncements.set(producerId, {
        kind: queued.kind,
        source: queued.source,
        routingMode: queued.routingMode,
        username: queued.username,
      });
    });
  }
}

export async function initializeMediaTransports(channelId: string) {
  if (
    initializedForChannelId === channelId
    && device
    && sendTransport
    && recvTransport
  ) {
    return;
  }

  if (initializePromise) {
    if (initializingForChannelId === channelId) {
      return initializePromise;
    }

    try {
      await initializePromise;
    } catch {}

    if (
      initializedForChannelId === channelId
      && device
      && sendTransport
      && recvTransport
    ) {
      return;
    }
  }

  initializePromise = (async () => {
    initializingForChannelId = channelId;
    closeTransports();

    const capabilitiesResponse = await requestMediaSignal(channelId, "get_router_rtp_capabilities");
    if (capabilitiesResponse.action !== "router_rtp_capabilities") {
      throw new Error("Unexpected capabilities response from media signaling");
    }

    const routerRtpCapabilities = capabilitiesResponse.rtp_capabilities;
    if (!routerRtpCapabilities) {
      throw new Error("Router RTP capabilities were not provided by server");
    }

    const nextDevice = new Device();
    await nextDevice.load({
      routerRtpCapabilities: routerRtpCapabilities as Parameters<Device["load"]>[0]["routerRtpCapabilities"],
    });

    const sendTransportResponse = await requestMediaSignal(channelId, "create_webrtc_transport", {
      direction: "send",
    });
    const recvTransportResponse = await requestMediaSignal(channelId, "create_webrtc_transport", {
      direction: "recv",
    });

    if (sendTransportResponse.action !== "webrtc_transport_created") {
      throw new Error("Unexpected send transport response from media signaling");
    }

    if (recvTransportResponse.action !== "webrtc_transport_created") {
      throw new Error("Unexpected recv transport response from media signaling");
    }

    const nextSendTransport = nextDevice.createSendTransport(toTransportOptions(sendTransportResponse));
    const nextRecvTransport = nextDevice.createRecvTransport(toTransportOptions(recvTransportResponse));

    wireTransportConnect(channelId, nextSendTransport);
    wireTransportConnect(channelId, nextRecvTransport);
    wireSendTransportProduce(channelId, nextSendTransport);

    device = nextDevice;
    sendTransport = nextSendTransport;
    recvTransport = nextRecvTransport;
    initializedForChannelId = channelId;
    initializingForChannelId = null;

    await startLocalAudioProducer(channelId);
    flushQueuedProducerAnnouncements(channelId);
  })();

  try {
    await initializePromise;
  } finally {
    if (initializedForChannelId !== channelId) {
      initializingForChannelId = null;
    }
    initializePromise = null;
  }
}

export function setMicrophoneMuted(muted: boolean) {
  microphoneMuted = muted;
  if (micTrack) {
    micTrack.enabled = !muted;
  }

  const channelId = initializedForChannelId;
  if (!channelId) {
    return;
  }

  if (muted) {
    reportVoiceActivity(channelId, false);
  }
}

export function setSpeakersMuted(muted: boolean) {
  speakersMuted = muted;
  for (const audio of remoteAudioElements.values()) {
    audio.muted = muted;
  }
}

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

  nextTrack.enabled = !microphoneMuted;

  const previousStream = micStream;
  const previousTrack = micTrack;

  try {
    if (micProducer) {
      await micProducer.replaceTrack({ track: nextTrack });
    } else {
      micProducer = await sendTransport.produce({
        track: nextTrack,
        stopTracks: false,
        appData: {
          source: "microphone",
          routingMode: "sfu",
        },
      });

      micProducer.on("transportclose", () => {
        micProducer = null;
      });

      micProducer.on("trackended", () => {
        micProducer = null;
      });
    }

    micStream = nextStream;
    micTrack = nextTrack;
    startMicLevelMonitoring(initializedForChannelId, nextStream);
    previousTrack?.stop();
    previousStream?.getTracks().forEach((track) => track.stop());
    savePreferredAudioInputDeviceId(deviceId);
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

  if (initializedForChannelId && sendTransport) {
    await setPreferredMicrophoneDevice(null);
  }

  if (isSpeakerSelectionSupported()) {
    await Promise.all(
      Array.from(remoteAudioElements.values()).map((audio) => applySpeakerDeviceToElement(audio, null)),
    );
  }
}

export function cleanupMediaTransports() {
  closeTransports();

  for (const [requestId, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error("Media request was cancelled"));
    pendingRequests.delete(requestId);
  }
}
