import { Show, type JSX } from "solid-js";
import { connect } from "../../api/ws";
import {
  cameraEnabled,
  cameraError,
  micMuted,
  speakerMuted,
  voiceActionState,
  voiceHealthLevel,
} from "../../stores/voice";
import {
  CameraIcon,
  DisconnectIcon,
  MicrophoneIcon,
  SpeakerIcon,
} from "../icons";
import { voiceHealthLabel } from "./helpers";

export interface VoiceDockProps {
  connectedChannelName: string | null;
  cameraActionPending: boolean;
  onDisconnect: () => void;
  onToggleMicMuted: () => void;
  onToggleSpeakerMuted: () => void;
  onToggleCamera: () => void;
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
    </div>
  );
}
