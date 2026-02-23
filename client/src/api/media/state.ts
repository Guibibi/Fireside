import type { Device } from "mediasoup-client";
import type { Consumer, Producer, Transport } from "mediasoup-client/types";
import type {
  CameraStateSnapshot,
  MediaSource,
  PendingRequest,
  QueuedProducerAnnouncement,
  RemoteVideoTile,
  RoutingMode,
  ScreenShareStateSnapshot,
  TransportHealthState,
} from "./types";

// Device and transport state
export let device: Device | null = null;
export let sendTransport: Transport | null = null;
export let recvTransport: Transport | null = null;

// Microphone state
export let micProducer: Producer | null = null;
export let micStream: MediaStream | null = null;
export let micTrack: MediaStreamTrack | null = null;

// Camera state
export let cameraProducer: Producer | null = null;
export let cameraStream: MediaStream | null = null;
export let cameraTrack: MediaStreamTrack | null = null;
export let cameraEnabled = false;
export let cameraError: string | null = null;

// Screen share state
export let screenProducer: Producer | null = null;
export let screenStream: MediaStream | null = null;
export let screenTrack: MediaStreamTrack | null = null;
export let screenEnabled = false;
export let screenError: string | null = null;
export let screenRoutingMode: RoutingMode | null = null;

// Native capture state
export let nativeScreenProducerId: string | null = null;
export let nativeFallbackMonitorTimer: ReturnType<typeof setInterval> | null = null;
export let nativeFallbackMonitorRunning = false;
export let nativeCaptureAttempted = false;

// Initialization state
export let initializedForChannelId: string | null = null;
export let initializingForChannelId: string | null = null;
export let initializePromise: Promise<void> | null = null;
export let signalListenerInitialized = false;
export let requestCounter = 0;

// Audio state
export let microphoneMuted = false;
export let speakersMuted = false;

// Mic level monitoring state
export let micLevelAudioContext: AudioContext | null = null;
export let micLevelSourceNode: MediaStreamAudioSourceNode | null = null;
export let micLevelAnalyserNode: AnalyserNode | null = null;
export let micLevelData: Uint8Array | null = null;
export let micLevelMonitorFrame: ReturnType<typeof setTimeout> | null = null;
export let micSpeakingHoldUntil = 0;
export let micSpeakingLastSent = false;

// Device change listener state
export let deviceChangeListenerRegistered = false;
export let handlingDeviceChange = false;

// Collections
export const remoteConsumers = new Map<string, Consumer>();
export const consumerIdByProducerId = new Map<string, string>();
export const remoteAudioElements = new Map<string, HTMLAudioElement>();
export const queuedProducerAnnouncements = new Map<string, QueuedProducerAnnouncement>();
export const producerUsernameById = new Map<string, string>();
export const producerSourceById = new Map<string, MediaSource>();
export const producerRoutingModeById = new Map<string, RoutingMode>();
export const remoteVideoTilesByProducerId = new Map<string, RemoteVideoTile>();
export const pendingRequests = new Map<string, PendingRequest>();

// Per-user volume: GainNode routing state
export let remotePlaybackAudioContext: AudioContext | null = null;
export const consumerSourceNodes = new Map<string, MediaStreamAudioSourceNode>();
export const consumerNormalizationNodes = new Map<string, DynamicsCompressorNode>();
export const consumerGainNodes = new Map<string, GainNode>();
export const consumerUsernameByConsumerId = new Map<string, string>();

// Transport health state
export let transportHealthState: TransportHealthState = "new";
export function setTransportHealthState(value: TransportHealthState) { transportHealthState = value; }
export const transportHealthSubscribers = new Set<(state: TransportHealthState) => void>();

// Subscribers
export const videoTilesSubscribers = new Set<(tiles: RemoteVideoTile[]) => void>();
export const cameraStateSubscribers = new Set<(snapshot: CameraStateSnapshot) => void>();
export const screenStateSubscribers = new Set<(snapshot: ScreenShareStateSnapshot) => void>();
export const audioPlaybackErrorSubscribers = new Set<(username: string | undefined) => void>();

// State setters
export function setDevice(value: Device | null) { device = value; }
export function setSendTransport(value: Transport | null) { sendTransport = value; }
export function setRecvTransport(value: Transport | null) { recvTransport = value; }

export function setMicProducer(value: Producer | null) { micProducer = value; }
export function setMicStream(value: MediaStream | null) { micStream = value; }
export function setMicTrack(value: MediaStreamTrack | null) { micTrack = value; }

export function setCameraProducer(value: Producer | null) { cameraProducer = value; }
export function setCameraStream(value: MediaStream | null) { cameraStream = value; }
export function setCameraTrack(value: MediaStreamTrack | null) { cameraTrack = value; }
export function setCameraEnabled(value: boolean) { cameraEnabled = value; }
export function setCameraError(value: string | null) { cameraError = value; }

export function setScreenProducer(value: Producer | null) { screenProducer = value; }
export function setScreenStream(value: MediaStream | null) { screenStream = value; }
export function setScreenTrack(value: MediaStreamTrack | null) { screenTrack = value; }
export function setScreenEnabled(value: boolean) { screenEnabled = value; }
export function setScreenError(value: string | null) { screenError = value; }
export function setScreenRoutingMode(value: RoutingMode | null) { screenRoutingMode = value; }

export function setNativeScreenProducerId(value: string | null) { nativeScreenProducerId = value; }
export function setNativeFallbackMonitorTimer(value: ReturnType<typeof setInterval> | null) { nativeFallbackMonitorTimer = value; }
export function setNativeFallbackMonitorRunning(value: boolean) { nativeFallbackMonitorRunning = value; }
export function setNativeCaptureAttempted(value: boolean) { nativeCaptureAttempted = value; }

export function setInitializedForChannelId(value: string | null) { initializedForChannelId = value; }
export function setInitializingForChannelId(value: string | null) { initializingForChannelId = value; }
export function setInitializePromise(value: Promise<void> | null) { initializePromise = value; }
export function setSignalListenerInitialized(value: boolean) { signalListenerInitialized = value; }
export function incrementRequestCounter() { requestCounter += 1; return requestCounter; }

export function setMicrophoneMutedState(value: boolean) { microphoneMuted = value; }
export function setSpeakersMutedState(value: boolean) { speakersMuted = value; }

export function setMicLevelAudioContext(value: AudioContext | null) { micLevelAudioContext = value; }
export function setMicLevelSourceNode(value: MediaStreamAudioSourceNode | null) { micLevelSourceNode = value; }
export function setMicLevelAnalyserNode(value: AnalyserNode | null) { micLevelAnalyserNode = value; }
export function setMicLevelData(value: Uint8Array | null) { micLevelData = value; }
export function setMicLevelMonitorFrame(value: ReturnType<typeof setTimeout> | null) { micLevelMonitorFrame = value; }
export function setMicSpeakingHoldUntil(value: number) { micSpeakingHoldUntil = value; }
export function setMicSpeakingLastSent(value: boolean) { micSpeakingLastSent = value; }

export function setDeviceChangeListenerRegistered(value: boolean) { deviceChangeListenerRegistered = value; }
export function setHandlingDeviceChange(value: boolean) { handlingDeviceChange = value; }
export function setRemotePlaybackAudioContext(value: AudioContext | null) { remotePlaybackAudioContext = value; }
