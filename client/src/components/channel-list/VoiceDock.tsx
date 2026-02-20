import { Show, type JSX } from "solid-js";
import type { NativeCaptureStatus } from "../../api/nativeCapture";
import { connect } from "../../api/ws";
import {
  cameraEnabled,
  cameraError,
  micMuted,
  screenShareEnabled,
  screenShareError,
  screenShareRoutingMode,
  speakerMuted,
  voiceActionState,
  voiceHealthLevel,
} from "../../stores/voice";
import {
  DisconnectIcon,
  MicrophoneIcon,
  SpeakerIcon,
  CameraIcon,
  ScreenShareIcon,
} from "../icons";
import { formatNativeSenderRate, voiceHealthLabel } from "./helpers";

export interface VoiceDockProps {
  connectedChannelName: string | null;
  nativeDebugEnabled: boolean;
  nativeSenderMetrics: NativeCaptureStatus["native_sender"] | null;
  cameraActionPending: boolean;
  screenActionPending: boolean;
  onDisconnect: () => void;
  onToggleMicMuted: () => void;
  onToggleSpeakerMuted: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
}

export default function VoiceDock(props: VoiceDockProps): JSX.Element {
  return (
    <div class="voice-dock">
      <div class="voice-dock-actions">
        <button
          type="button"
          class="voice-dock-icon voice-dock-disconnect"
          onClick={props.onDisconnect}
          disabled={voiceActionState() !== "idle"}
          title={voiceActionState() === "leaving" ? "Disconnecting..." : "Disconnect"}
          aria-label={voiceActionState() === "leaving" ? "Disconnecting..." : "Disconnect"}
        >
          <DisconnectIcon />
        </button>
        <button
          type="button"
          class="voice-dock-icon voice-dock-toggle"
          onClick={props.onToggleMicMuted}
          title={micMuted() ? "Unmute microphone" : "Mute microphone"}
          aria-label={micMuted() ? "Unmute microphone" : "Mute microphone"}
        >
          <MicrophoneIcon muted={micMuted()} />
        </button>
        <button
          type="button"
          class="voice-dock-icon voice-dock-toggle"
          onClick={props.onToggleSpeakerMuted}
          title={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
          aria-label={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
        >
          <SpeakerIcon muted={speakerMuted()} />
        </button>
        <button
          type="button"
          class={`voice-dock-icon voice-dock-toggle voice-dock-camera${cameraEnabled() ? " is-active" : ""}`}
          onClick={props.onToggleCamera}
          disabled={props.cameraActionPending || voiceActionState() !== "idle"}
          title={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
          aria-label={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
        >
          <CameraIcon enabled={cameraEnabled()} />
        </button>
        <button
          type="button"
          class={`voice-dock-icon voice-dock-toggle voice-dock-screen${screenShareEnabled() ? " is-active" : ""}`}
          onClick={props.onToggleScreenShare}
          disabled={props.screenActionPending || voiceActionState() !== "idle"}
          title={screenShareEnabled() ? "Stop screen share" : "Start screen share"}
          aria-label={screenShareEnabled() ? "Stop screen share" : "Start screen share"}
        >
          <ScreenShareIcon />
        </button>
      </div>
      <p class="voice-dock-channel">Connected: {props.connectedChannelName}</p>
      <p class={`voice-dock-status voice-dock-status-${voiceHealthLevel()}`}>
        <span class="voice-dock-status-dot" />
        {voiceHealthLabel(voiceHealthLevel())}
      </p>
      <Show when={voiceHealthLevel() === "failed"}>
        <button type="button" class="settings-secondary" onClick={() => connect()}>
          Retry connection
        </button>
      </Show>
      <Show when={cameraError()}>
        <p class="voice-dock-error">{cameraError()}</p>
      </Show>
      <Show when={screenShareEnabled() && screenShareRoutingMode()}>
        <p class="voice-dock-channel">Screen sharing via {screenShareRoutingMode()?.toUpperCase()}</p>
      </Show>
      <Show when={screenShareEnabled() && props.nativeDebugEnabled && props.nativeSenderMetrics?.worker_active}>
        <div class="voice-dock-native-debug" role="status" aria-live="polite">
          <p class="voice-dock-native-debug-title">Native Sender</p>
          <p class="voice-dock-channel">Frames: {props.nativeSenderMetrics?.received_packets ?? 0} dequeued / {props.nativeSenderMetrics?.encoded_frames ?? 0} encoded</p>
          <p class="voice-dock-channel">Output: {formatNativeSenderRate(props.nativeSenderMetrics?.encoded_bytes ?? 0)} | RTP: {props.nativeSenderMetrics?.rtp_packets_sent ?? 0} packets</p>
          <p class="voice-dock-channel">Queue backlog: {props.nativeSenderMetrics?.estimated_queue_depth ?? 0} | Drop(full): {props.nativeSenderMetrics?.dropped_full ?? 0} | Drop(pre-encode): {props.nativeSenderMetrics?.dropped_before_encode ?? 0}</p>
          <p class="voice-dock-channel">Latency: {props.nativeSenderMetrics?.last_encode_latency_ms ?? 0} ms | Encode errors: {props.nativeSenderMetrics?.encode_errors ?? 0} | RTP errors: {props.nativeSenderMetrics?.rtp_send_errors ?? 0} | Drop(send): {props.nativeSenderMetrics?.dropped_during_send ?? 0}</p>
          <p class="voice-dock-channel">Keyframe requests: {props.nativeSenderMetrics?.keyframe_requests ?? 0} | Drop(no BGRA): {props.nativeSenderMetrics?.dropped_missing_bgra ?? 0}</p>
          <p class="voice-dock-channel">Transport: {props.nativeSenderMetrics?.transport_connected ? "connected" : "disconnected"} | Producer: {props.nativeSenderMetrics?.producer_connected ? "connected" : "disconnected"}</p>
          <p class="voice-dock-channel">Degradation: {props.nativeSenderMetrics?.degradation_level ?? "none"} | Fallback: {props.nativeSenderMetrics?.recent_fallback_reason ?? "none"}</p>
          <p class="voice-dock-channel">Pressure(avg/peak/max): {props.nativeSenderMetrics?.pressure_window_avg_depth ?? 0}/{props.nativeSenderMetrics?.pressure_window_peak_depth ?? 0}/{props.nativeSenderMetrics?.pressure_window_max_peak_depth ?? 0}</p>
          <p class="voice-dock-channel">Encoder backend: {props.nativeSenderMetrics?.encoder_backend ?? "unknown"}</p>
          <p class="voice-dock-channel">Encoder requested: {props.nativeSenderMetrics?.encoder_backend_requested ?? "unknown"} | Backend fallback: {props.nativeSenderMetrics?.encoder_backend_fallback_reason ?? "none"}</p>
          <p class="voice-dock-channel">Backend runtime fallback events: {props.nativeSenderMetrics?.encoder_backend_runtime_fallback_events ?? 0}</p>
          <Show when={props.nativeSenderMetrics?.rtp_target}>
            <p class="voice-dock-channel">RTP target: {props.nativeSenderMetrics?.rtp_target}</p>
          </Show>
        </div>
      </Show>
      <Show when={screenShareError()}>
        <p class="voice-dock-error">{screenShareError()}</p>
      </Show>
    </div>
  );
}
