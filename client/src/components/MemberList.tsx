import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { get } from "../api/http";
import { connect, onMessage, type PresenceUser } from "../api/ws";
import { activeChannelId } from "../stores/chat";
import { participantsInChannel } from "../stores/voice";
import { openContextMenu, registerContextMenuHandlers, handleLongPressStart, handleLongPressEnd, setContextMenuTarget } from "../stores/contextMenu";
import UserAvatar from "./UserAvatar";
import { setUserProfiles, upsertUserProfile } from "../stores/userProfiles";

interface UsersResponse {
  usernames: string[];
  users?: { username: string; avatar_url: string | null }[];
}

export default function MemberList() {
  const [allMembers, setAllMembers] = createSignal<string[]>([]);
  const [onlineMembers, setOnlineMembers] = createSignal<string[]>([]);
  const [idleMembers, setIdleMembers] = createSignal<string[]>([]);
  const connectedMembers = createMemo(() => [...new Set([...onlineMembers(), ...idleMembers()])].sort((a, b) => a.localeCompare(b)));
  const idleSet = createMemo(() => new Set(idleMembers()));
  const activeVoiceParticipants = createMemo(() => new Set(participantsInChannel(activeChannelId())));
  const offlineMembers = createMemo(() => {
    const connected = new Set(connectedMembers());
    return allMembers().filter((member) => !connected.has(member));
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
        if (response.users) {
          setUserProfiles(response.users);
        }
        setAllMembers([...response.usernames].sort((a, b) => a.localeCompare(b)));
      })
      .catch((error) => {
        console.error("Failed to load server members:", error);
      });

    const unsubscribe = onMessage((msg) => {
      if (msg.type === "presence_snapshot") {
        const users = msg.users;

        const online = users
          .filter((user: PresenceUser) => user.status === "online")
          .map((user: PresenceUser) => user.username)
          .sort((a: string, b: string) => a.localeCompare(b));
        const idle = users
          .filter((user: PresenceUser) => user.status === "idle")
          .map((user: PresenceUser) => user.username)
          .sort((a: string, b: string) => a.localeCompare(b));
        const usernames = users.map((user: PresenceUser) => user.username);

        setOnlineMembers(online);
        setIdleMembers(idle);
        setAllMembers((current) => [...new Set([...current, ...usernames])].sort((a, b) => a.localeCompare(b)));
        return;
      }

      if (msg.type === "user_connected") {
        upsertUserProfile({ username: msg.username, avatar_url: null });
        setOnlineMembers((current) => [...new Set([...current, msg.username])].sort((a, b) => a.localeCompare(b)));
        setIdleMembers((current) => current.filter((member) => member !== msg.username));
        setAllMembers((current) => {
          if (current.includes(msg.username)) {
            return current;
          }

          return [...current, msg.username].sort((a, b) => a.localeCompare(b));
        });
        return;
      }

      if (msg.type === "user_status_changed") {
        if (msg.status === "idle") {
          setOnlineMembers((current) => current.filter((member) => member !== msg.username));
          setIdleMembers((current) => [...new Set([...current, msg.username])].sort((a, b) => a.localeCompare(b)));
        } else {
          setIdleMembers((current) => current.filter((member) => member !== msg.username));
          setOnlineMembers((current) => [...new Set([...current, msg.username])].sort((a, b) => a.localeCompare(b)));
        }
        return;
      }

      if (msg.type === "user_disconnected") {
        setOnlineMembers((current) => current.filter((member) => member !== msg.username));
        setIdleMembers((current) => current.filter((member) => member !== msg.username));
      }
    });

    onCleanup(unsubscribe);
  });

  return (
    <aside class="member-list">
      <h3>Members</h3>
      <Show when={allMembers().length > 0} fallback={<p class="placeholder">No members found</p>}>
        <h4 class="member-section-title">Online ({connectedMembers().length})</h4>
        <Show when={connectedMembers().length > 0} fallback={<p class="placeholder">Nobody online</p>}>
          <ul class="member-items">
            <For each={connectedMembers()}>
              {(member) => (
                <li
                  class={`member-item${idleSet().has(member) ? " member-item-idle" : ""}`}
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
                  <UserAvatar username={member} class="member-avatar" size={28} />
                  <span class="member-name">
                    <span
                      class={`member-status-dot ${idleSet().has(member) ? "member-status-dot-idle" : "member-status-dot-online"}`}
                      aria-hidden="true"
                    />
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
                  <UserAvatar username={member} class="member-avatar" size={28} />
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
