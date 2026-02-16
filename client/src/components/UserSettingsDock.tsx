import { onMount } from "solid-js";
import { username as currentUsername } from "../stores/auth";
import { openSettings } from "../stores/settings";
import UserAvatar from "./UserAvatar";
import { upsertUserProfile } from "../stores/userProfiles";
import { getApiBaseUrl, token } from "../stores/auth";

interface CurrentUserResponse {
  username: string;
  avatar_url: string | null;
}

export default function UserSettingsDock() {
  function avatarFallbackLabel() {
    const usernameValue = currentUsername()?.trim();
    if (usernameValue && usernameValue.length > 0) {
      return usernameValue.slice(0, 1).toUpperCase();
    }

    return "?";
  }

  async function refreshCurrentUserProfile() {
    try {
      const response = await fetch(`${getApiBaseUrl()}/users/me`, {
        headers: {
          Authorization: `Bearer ${token() ?? ""}`,
        },
      });
      if (!response.ok) {
        return;
      }

      const profile = await response.json() as CurrentUserResponse;
      upsertUserProfile({ username: profile.username, avatar_url: profile.avatar_url });
    } catch {
      // no-op
    }
  }

  onMount(() => {
    void refreshCurrentUserProfile();
  });

  return (
    <div class="user-dock">
      <UserAvatar username={currentUsername() ?? avatarFallbackLabel()} class="user-dock-avatar" size={42} />
      <div class="user-dock-meta">
        <p class="user-dock-name">{currentUsername() ?? "Unknown user"}</p>
        <p class="user-dock-subtitle">Online</p>
      </div>
      <button
        type="button"
        class="user-dock-settings"
        onClick={() => openSettings()}
        aria-label="Open settings"
        title="Settings"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.49.49 0 0 0-.49-.42h-3.84a.49.49 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94 7.43 7.43 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.73 1.63.94l.36 2.54a.49.49 0 0 0 .49.42h3.84a.49.49 0 0 0 .49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
