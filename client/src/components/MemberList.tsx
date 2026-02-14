import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { get } from "../api/http";
import { connect, onMessage } from "../api/ws";
import { activeChannelId } from "../stores/chat";
import { participantsInChannel } from "../stores/voice";
import { openContextMenu, registerContextMenuHandlers, handleLongPressStart, handleLongPressEnd, setContextMenuTarget } from "../stores/contextMenu";

interface UsersResponse {
  usernames: string[];
}

export default function MemberList() {
  const [allMembers, setAllMembers] = createSignal<string[]>([]);
  const [onlineMembers, setOnlineMembers] = createSignal<string[]>([]);
  const activeVoiceParticipants = createMemo(() => new Set(participantsInChannel(activeChannelId())));
  const offlineMembers = createMemo(() => {
    const online = new Set(onlineMembers());
    return allMembers().filter((member) => !online.has(member));
  });

  onMount(() => {
    connect();

    // TODO: Implement profile viewing and DM features
    registerContextMenuHandlers({
      member: {
        onViewProfile: (_member) => {
          // TODO: Open profile modal/panel
        },
        onSendMessage: (_member) => {
          // TODO: Open DM channel or create one
        },
      },
    });

    void get<UsersResponse>("/users")
      .then((response) => {
        setAllMembers([...response.usernames].sort((a, b) => a.localeCompare(b)));
      })
      .catch((error) => {
        console.error("Failed to load server members:", error);
      });

    const unsubscribe = onMessage((msg) => {
      if (msg.type === "presence_snapshot") {
        setOnlineMembers([...msg.usernames].sort((a, b) => a.localeCompare(b)));
        setAllMembers((current) => [...new Set([...current, ...msg.usernames])].sort((a, b) => a.localeCompare(b)));
        return;
      }

      if (msg.type === "user_connected") {
        setOnlineMembers((current) => {
          if (current.includes(msg.username)) {
            return current;
          }

          return [...current, msg.username].sort((a, b) => a.localeCompare(b));
        });
        setAllMembers((current) => {
          if (current.includes(msg.username)) {
            return current;
          }

          return [...current, msg.username].sort((a, b) => a.localeCompare(b));
        });
        return;
      }

      if (msg.type === "user_disconnected") {
        setOnlineMembers((current) => current.filter((member) => member !== msg.username));
      }
    });

    onCleanup(unsubscribe);
  });

  return (
    <aside class="member-list">
      <h3>Members</h3>
      <Show when={allMembers().length > 0} fallback={<p class="placeholder">No members found</p>}>
        <h4 class="member-section-title">Online ({onlineMembers().length})</h4>
        <Show when={onlineMembers().length > 0} fallback={<p class="placeholder">Nobody online</p>}>
          <ul class="member-items">
            <For each={onlineMembers()}>
              {(member) => (
                <li
                  class="member-item"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, "member", member, { username: member });
                  }}
                  onFocus={() => setContextMenuTarget("member", member, { username: member })}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    handleLongPressStart(touch.clientX, touch.clientY, "member", member, { username: member });
                  }}
                  onTouchEnd={handleLongPressEnd}
                >
                  <span class="member-name">
                    <span class="member-status-dot member-status-dot-online" aria-hidden="true" />
                    <span>{member}</span>
                  </span>
                  <Show when={activeVoiceParticipants().has(member)}>
                    <span class="member-voice-indicator">in voice</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <h4 class="member-section-title">Offline ({offlineMembers().length})</h4>
        <Show when={offlineMembers().length > 0} fallback={<p class="placeholder">Nobody offline</p>}>
          <ul class="member-items">
            <For each={offlineMembers()}>
              {(member) => (
                <li
                  class="member-item member-item-offline"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, "member", member, { username: member });
                  }}
                  onFocus={() => setContextMenuTarget("member", member, { username: member })}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    handleLongPressStart(touch.clientX, touch.clientY, "member", member, { username: member });
                  }}
                  onTouchEnd={handleLongPressEnd}
                >
                  <span class="member-name">
                    <span class="member-status-dot member-status-dot-offline" aria-hidden="true" />
                    <span>{member}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </aside>
  );
}
