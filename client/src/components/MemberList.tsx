import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { get } from "../api/http";
import { openDmWithUser } from "../api/dms";
import { connect, onMessage, type PresenceUser } from "../api/ws";
import { activeChannelId, setActiveDmThread } from "../stores/chat";
import { participantsInChannel } from "../stores/voice";
import { openContextMenu, registerContextMenuHandlers, handleLongPressStart, handleLongPressEnd, setContextMenuTarget } from "../stores/contextMenu";
import UserAvatar from "./UserAvatar";
import { displayNameFor, profileFor, setUserProfiles, upsertUserProfile } from "../stores/userProfiles";
import { openProfileModal } from "../stores/profileModal";
import { upsertDmThread } from "../stores/dms";
import { errorMessage } from "../utils/error";

interface UsersResponse {
  usernames: string[];
  users?: {
    username: string;
    display_name: string;
    avatar_url: string | null;
    profile_description?: string | null;
    profile_status?: string | null;
  }[];
}

export default function MemberList() {
  const MEMBER_PREVIEW_HOVER_DELAY_MS = 1000;
  const MEMBER_PREVIEW_WIDTH_PX = 250;
  const MEMBER_PREVIEW_OFFSET_PX = 12;
  const MEMBER_PREVIEW_VIEWPORT_PADDING_PX = 12;

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
  const [actionError, setActionError] = createSignal("");
  const [hoverPreviewUsername, setHoverPreviewUsername] = createSignal<string | null>(null);
  const [hoverPreviewPosition, setHoverPreviewPosition] = createSignal({ top: 0, left: 0 });
  let hoverPreviewTimer: ReturnType<typeof setTimeout> | null = null;

  function profileStatusFor(username: string): string | null {
    const status = profileFor(username)?.profile_status?.trim();
    return status && status.length > 0 ? status : null;
  }

  function profileDescriptionFor(username: string): string | null {
    const description = profileFor(username)?.profile_description?.trim();
    return description && description.length > 0 ? description : null;
  }

  function clearHoverPreviewTimer() {
    if (!hoverPreviewTimer) {
      return;
    }
    clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = null;
  }

  function hideHoverPreview() {
    clearHoverPreviewTimer();
    setHoverPreviewUsername(null);
  }

  function previewPositionFor(anchorElement: HTMLElement) {
    const rect = anchorElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const preferLeft = rect.left >= MEMBER_PREVIEW_WIDTH_PX + MEMBER_PREVIEW_OFFSET_PX + MEMBER_PREVIEW_VIEWPORT_PADDING_PX;
    const left = preferLeft
      ? rect.left - MEMBER_PREVIEW_WIDTH_PX - MEMBER_PREVIEW_OFFSET_PX
      : rect.right + MEMBER_PREVIEW_OFFSET_PX;
    const maxTop = viewportHeight - MEMBER_PREVIEW_VIEWPORT_PADDING_PX - 160;
    const top = Math.min(
      Math.max(MEMBER_PREVIEW_VIEWPORT_PADDING_PX, rect.top),
      Math.max(MEMBER_PREVIEW_VIEWPORT_PADDING_PX, maxTop),
    );

    return {
      top,
      left: Math.max(MEMBER_PREVIEW_VIEWPORT_PADDING_PX, Math.min(left, viewportWidth - MEMBER_PREVIEW_WIDTH_PX - MEMBER_PREVIEW_VIEWPORT_PADDING_PX)),
    };
  }

  function handleMemberHoverStart(member: string, anchorElement: HTMLElement) {
    clearHoverPreviewTimer();
    hoverPreviewTimer = setTimeout(() => {
      setHoverPreviewPosition(previewPositionFor(anchorElement));
      setHoverPreviewUsername(member);
    }, MEMBER_PREVIEW_HOVER_DELAY_MS);
  }

  async function startDmWithMember(memberUsername: string) {
    try {
      const response = await openDmWithUser(memberUsername);
      upsertDmThread(response.thread);
      setActiveDmThread(response.thread.thread_id);
      setActionError("");
    } catch (error) {
      setActionError(errorMessage(error, "Failed to open DM"));
    }
  }

  function openMemberProfile(memberUsername: string) {
    hideHoverPreview();
    openProfileModal(memberUsername);
  }

  function handleMemberKeyDown(event: KeyboardEvent, memberUsername: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMemberProfile(memberUsername);
    }
  }

  onMount(() => {
    connect();

    registerContextMenuHandlers({
      member: {
        onViewProfile: (member) => {
          openProfileModal(member.username);
        },
        onSendMessage: (member) => {
          void startDmWithMember(member.username);
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
        upsertUserProfile({
          username: msg.username,
          display_name: displayNameFor(msg.username),
          avatar_url: null,
        });
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
        return;
      }

      if (msg.type === "user_profile_updated") {
        upsertUserProfile({
          username: msg.username,
          display_name: msg.display_name,
          avatar_url: msg.avatar_url,
          profile_description: msg.profile_description,
          profile_status: msg.profile_status,
        });
      }
    });

    onCleanup(unsubscribe);
  });

  onCleanup(() => {
    hideHoverPreview();
  });

  return (
    <aside class="member-list" onScroll={hideHoverPreview}>
      <h3>Members</h3>
      <Show when={allMembers().length > 0} fallback={<p class="placeholder">No members found</p>}>
        <Show when={actionError()}>
          <p class="error">{actionError()}</p>
        </Show>
        <h4 class="member-section-title">Online ({connectedMembers().length})</h4>
        <Show when={connectedMembers().length > 0} fallback={<p class="placeholder">Nobody online</p>}>
          <ul class="member-items">
            <For each={connectedMembers()}>
              {(member) => (
                <li
                  class={`member-item${idleSet().has(member) ? " member-item-idle" : ""}`}
                  tabIndex={0}
                  onClick={() => openMemberProfile(member)}
                  onKeyDown={(event) => handleMemberKeyDown(event, member)}
                  onMouseEnter={(event) => handleMemberHoverStart(member, event.currentTarget)}
                  onMouseLeave={hideHoverPreview}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    hideHoverPreview();
                    openContextMenu(e.clientX, e.clientY, "member", member, { username: member });
                  }}
                  onFocus={() => setContextMenuTarget("member", member, { username: member })}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    hideHoverPreview();
                    handleLongPressStart(touch.clientX, touch.clientY, "member", member, { username: member });
                  }}
                  onTouchEnd={handleLongPressEnd}
                >
                  <span class="member-avatar-wrap">
                    <UserAvatar username={member} class="member-avatar" size={28} />
                    <span
                      class={`member-status-dot ${idleSet().has(member) ? "member-status-dot-idle" : "member-status-dot-online"}`}
                      aria-hidden="true"
                    />
                  </span>
                  <span class="member-name">
                    <span class="member-display-name">{displayNameFor(member)}</span>
                    <Show when={profileStatusFor(member)}>
                      {(status) => <span class="member-profile-status">{status()}</span>}
                    </Show>
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
                  tabIndex={0}
                  onClick={() => openMemberProfile(member)}
                  onKeyDown={(event) => handleMemberKeyDown(event, member)}
                  onMouseEnter={(event) => handleMemberHoverStart(member, event.currentTarget)}
                  onMouseLeave={hideHoverPreview}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    hideHoverPreview();
                    openContextMenu(e.clientX, e.clientY, "member", member, { username: member });
                  }}
                  onFocus={() => setContextMenuTarget("member", member, { username: member })}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    hideHoverPreview();
                    handleLongPressStart(touch.clientX, touch.clientY, "member", member, { username: member });
                  }}
                  onTouchEnd={handleLongPressEnd}
                >
                  <span class="member-avatar-wrap">
                    <UserAvatar username={member} class="member-avatar" size={28} />
                    <span class="member-status-dot member-status-dot-offline" aria-hidden="true" />
                  </span>
                  <span class="member-name">
                    <span class="member-display-name">{displayNameFor(member)}</span>
                    <Show when={profileStatusFor(member)}>
                      {(status) => <span class="member-profile-status">{status()}</span>}
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={hoverPreviewUsername()}>
        {(member) => (
          <div
            class="member-hover-preview"
            style={{
              top: `${hoverPreviewPosition().top}px`,
              left: `${hoverPreviewPosition().left}px`,
              width: `${MEMBER_PREVIEW_WIDTH_PX}px`,
            }}
            role="status"
            aria-live="polite"
          >
            <div class="member-hover-preview-head">
              <UserAvatar username={member()} size={40} />
              <div class="member-hover-preview-identity">
                <p class="member-hover-preview-name">{displayNameFor(member())}</p>
                <p class="member-hover-preview-username">@{member()}</p>
              </div>
            </div>
            <Show when={profileStatusFor(member())}>
              {(status) => <p class="member-hover-preview-status">{status()}</p>}
            </Show>
            <Show when={profileDescriptionFor(member())}>
              {(description) => <p class="member-hover-preview-description">{description()}</p>}
            </Show>
          </div>
        )}
      </Show>
    </aside>
  );
}
