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
import {
  handleLongPressEnd,
  handleLongPressStart,
  openContextMenu,
  setContextMenuTarget,
} from "../stores/contextMenu";
import UserAvatar from "./UserAvatar";

export default function VoicePanel() {
  const viewedChannelId = createMemo(() => joinedVoiceChannelId() ?? activeChannelId());
  const viewedParticipants = createMemo(() => participantsInChannel(viewedChannelId()));
  const canJoin = createMemo(() => !!activeChannelId() && voiceActionState() === "idle");
  const canLeave = createMemo(() => !!joinedVoiceChannelId() && voiceActionState() === "idle");
  const isConnected = createMemo(() => !!joinedVoiceChannelId());

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
              <li
                class={`voice-participant${isConnected() ? " voice-participant-connected" : ""}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, "member", participant, { username: participant });
                }}
                onFocus={() => setContextMenuTarget("member", participant, { username: participant })}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  handleLongPressStart(touch.clientX, touch.clientY, "member", participant, { username: participant });
                }}
                onTouchEnd={handleLongPressEnd}
                onTouchCancel={handleLongPressEnd}
              >
                <span class="voice-participant-name">
                  <UserAvatar
                    username={participant}
                    class="voice-participant-avatar"
                    size={isConnected() ? 32 : 24}
                  />
                  <span>{participant}</span>
                </span>
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
