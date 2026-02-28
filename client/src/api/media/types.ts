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
  | "plain_transport_created"
  | "plain_transport_connected"
  | "media_produced"
  | "media_producer_closed"
  | "new_producer"
  | "media_consumer_created"
  | "media_consumer_resumed"
  | "producer_closed"
  | "signal_error";

export type MediaKind = "audio" | "video";
export type MediaSource = "microphone" | "camera" | "screen";
export type RoutingMode = "sfu";
export type ScreenCaptureKind = "monitor" | "window";

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
  screen_capture_kind?: ScreenCaptureKind;
  screen_capture_label?: string;
  consumer?: MediaConsumerDescription;
  consumer_id?: string;
  id?: string;
  ip?: string;
  port?: number;
  rtcp_port?: number | null;
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

export interface CameraStateSnapshot {
  enabled: boolean;
  error: string | null;
  stream: MediaStream | null;
}

export interface RemoteVideoTile {
  producerId: string;
  username: string;
  stream: MediaStream;
  source: "camera" | "screen";
  routingMode: RoutingMode;
  screenCaptureKind?: ScreenCaptureKind;
  screenCaptureLabel?: string;
}

export interface PlainTransportInfo {
  id: string;
  ip: string;
  port: number;
  rtcp_port: number | null;
}

export interface QueuedProducerAnnouncement {
  kind?: MediaKind;
  source?: MediaSource;
  routingMode?: RoutingMode;
  username?: string;
  screenCaptureKind?: ScreenCaptureKind;
  screenCaptureLabel?: string;
}

export type TransportHealthState = "new" | "connected" | "disconnected" | "failed" | "closed";

export type SinkableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};
