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
  voiceConnectionStatus,
} from "../../stores/voice";
import { connectionStatusLabel, formatNativeSenderRate } from "./helpers";

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
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M7 9a5 5 0 0 1 10 0v4h2V9a7 7 0 1 0-14 0v4h2z" fill="currentColor" />
            <path d="M12 22 8 18h3v-5h2v5h3z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          class="voice-dock-icon voice-dock-toggle"
          onClick={props.onToggleMicMuted}
          title={micMuted() ? "Unmute microphone" : "Mute microphone"}
          aria-label={micMuted() ? "Unmute microphone" : "Mute microphone"}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z" fill="currentColor" />
            <path d="M18 11v1a6 6 0 0 1-12 0v-1H4v1a8 8 0 0 0 7 7.94V23h2v-3.06A8 8 0 0 0 20 12v-1z" fill="currentColor" />
            <Show when={micMuted()}>
              <path d="M4 4 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
            </Show>
          </svg>
        </button>
        <button
          type="button"
          class="voice-dock-icon voice-dock-toggle"
          onClick={props.onToggleSpeakerMuted}
          title={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
          aria-label={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 10v4h4l5 4V6l-5 4z" fill="currentColor" />
            <Show when={!speakerMuted()}>
              <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
            </Show>
            <Show when={speakerMuted()}>
              <path d="M16 8 21 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
              <path d="M21 8 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
            </Show>
          </svg>
        </button>
        <button
          type="button"
          class={`voice-dock-icon voice-dock-toggle voice-dock-camera${cameraEnabled() ? " is-active" : ""}`}
          onClick={props.onToggleCamera}
          disabled={props.cameraActionPending || voiceActionState() !== "idle"}
          title={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
          aria-label={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h9A1.5 1.5 0 0 1 16 7.5v2.1l3.86-2.18A1 1 0 0 1 21.4 8.3v7.4a1 1 0 0 1-1.54.87L16 14.4v2.1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5z" fill="currentColor" />
            <Show when={cameraEnabled()}>
              <path d="M5 5 19 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
            </Show>
          </svg>
        </button>
        <button
          type="button"
          class={`voice-dock-icon voice-dock-toggle voice-dock-screen${screenShareEnabled() ? " is-active" : ""}`}
          onClick={props.onToggleScreenShare}
          disabled={props.screenActionPending || voiceActionState() !== "idle"}
          title={screenShareEnabled() ? "Stop screen share" : "Start screen share"}
          aria-label={screenShareEnabled() ? "Stop screen share" : "Start screen share"}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M3.5 5A1.5 1.5 0 0 1 5 3.5h14A1.5 1.5 0 0 1 20.5 5v10A1.5 1.5 0 0 1 19 16.5H5A1.5 1.5 0 0 1 3.5 15z" fill="currentColor" />
            <path d="M8.5 20h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
            <path d="M12 16.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
          </svg>
        </button>
      </div>
      <p class="voice-dock-channel">Connected: {props.connectedChannelName}</p>
      <p class={`voice-dock-channel${voiceConnectionStatus() === "failed" ? " voice-dock-channel-alert" : ""}`}>
        {connectionStatusLabel(voiceConnectionStatus())}
      </p>
      <Show when={voiceConnectionStatus() === "failed"}>
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
