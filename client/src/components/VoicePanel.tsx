import { For, Show, createMemo } from "solid-js";
import { send } from "../api/ws";
import { username } from "../stores/auth";
import { activeChannelId } from "../stores/chat";
import {
  joinedVoiceChannelId,
  participantsInChannel,
  setVoiceActionState,
  voiceActionState,
} from "../stores/voice";

export default function VoicePanel() {
  const viewedChannelId = createMemo(() => joinedVoiceChannelId() ?? activeChannelId());
  const viewedParticipants = createMemo(() => participantsInChannel(viewedChannelId()));
  const canJoin = createMemo(() => !!activeChannelId() && voiceActionState() === "idle");
  const canLeave = createMemo(() => !!joinedVoiceChannelId() && voiceActionState() === "idle");

  function handleJoin() {
    const channelId = activeChannelId();
    if (!channelId) {
      return;
    }

    setVoiceActionState("joining");
    send({ type: "join_voice", channel_id: channelId });
  }

  function handleLeave() {
    const channelId = joinedVoiceChannelId();
    if (!channelId) {
      return;
    }

    setVoiceActionState("leaving");
    send({ type: "leave_voice", channel_id: channelId });
  }

  return (
    <section class="voice-panel">
      <div class="voice-panel-header">
        <h4>Voice</h4>
        <Show when={joinedVoiceChannelId()} fallback={<span class="voice-status">Not connected</span>}>
          <span class="voice-status voice-status-live">Connected</span>
        </Show>
      </div>

      <div class="voice-actions">
        <button type="button" onClick={handleJoin} disabled={!canJoin()}>
          {voiceActionState() === "joining" ? "Joining..." : "Join"}
        </button>
        <button type="button" class="voice-leave" onClick={handleLeave} disabled={!canLeave()}>
          {voiceActionState() === "leaving" ? "Leaving..." : "Leave"}
        </button>
      </div>

      <Show when={joinedVoiceChannelId() && activeChannelId() && joinedVoiceChannelId() !== activeChannelId()}>
        <p class="voice-note">You are connected to another channel.</p>
      </Show>

      <Show when={viewedParticipants().length > 0} fallback={<p class="placeholder">No one in voice</p>}>
        <ul class="voice-participants">
          <For each={viewedParticipants()}>
            {(participant) => (
              <li class="voice-participant">
                <span>{participant}</span>
                <Show when={participant === username()}>
                  <span class="voice-you">you</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
