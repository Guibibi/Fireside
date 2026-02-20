import type { ScreenShareFps, ScreenShareResolution, ScreenShareSourceKind } from "../../stores/settings";

export interface IceParameters {
  usernameFragment: string;
  password: string;
  iceLite?: boolean;
}

export interface IceCandidate {
  foundation: string;
  priority: number;
  address: string;
  ip: string;
  protocol: "udp" | "tcp";
  port: number;
  type: "host" | "srflx" | "prflx" | "relay";
  tcpType?: "active" | "passive" | "so";
}

export interface DtlsParameters {
  role?: "auto" | "client" | "server";
  fingerprints: Array<{
    algorithm: "sha-1" | "sha-224" | "sha-256" | "sha-384" | "sha-512";
    value: string;
  }>;
}

export interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

export type MediaSignalAction =
  | "router_rtp_capabilities"
  | "webrtc_transport_created"
  | "webrtc_transport_connected"
  | "media_produced"
  | "media_producer_closed"
  | "new_producer"
  | "media_consumer_created"
  | "media_consumer_resumed"
  | "native_sender_session_created"
  | "producer_closed"
  | "signal_error";

export type MediaKind = "audio" | "video";
export type MediaSource = "microphone" | "camera" | "screen";
export type RoutingMode = "sfu";

export interface MediaConsumerDescription {
  id: string;
  producer_id: string;
  kind: MediaKind;
  rtp_parameters: unknown;
}

export interface MediaSignalPayload {
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
  rtp_target?: string;
  payload_type?: number;
  ssrc?: number;
  mime_type?: string;
  clock_rate?: number;
  packetization_mode?: number;
  profile_level_id?: string;
  codec?: {
    mime_type?: string;
    clock_rate?: number;
    payload_type?: number;
    packetization_mode?: number;
    profile_level_id?: string;
    readiness?: "ready" | "planned" | string;
  };
  available_codecs?: Array<{
    mime_type?: string;
    clock_rate?: number;
    payload_type?: number;
    packetization_mode?: number;
    profile_level_id?: string;
    readiness?: "ready" | "planned" | string;
  }>;
}

export interface PendingRequest {
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

export interface CameraDeviceOption {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}

export interface CameraActionResult {
  ok: boolean;
  error?: string;
}

export interface ScreenShareStartOptions {
  resolution: ScreenShareResolution;
  fps: ScreenShareFps;
  bitrateKbps: number;
  sourceKind: ScreenShareSourceKind;
  sourceId?: string;
  sourceTitle?: string;
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

export interface QueuedProducerAnnouncement {
  kind?: MediaKind;
  source?: MediaSource;
  routingMode?: RoutingMode;
  username?: string;
}

export type TransportHealthState = "new" | "connected" | "disconnected" | "failed" | "closed";

export type SinkableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};
