import { onMount } from "solid-js";
import { username as currentUsername } from "../stores/auth";
import { openSettings } from "../stores/settings";
import UserAvatar from "./UserAvatar";
import { upsertUserProfile } from "../stores/userProfiles";
import { getApiBaseUrl, token } from "../stores/auth";
import { SettingsIcon } from "./icons";

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
        <SettingsIcon />
      </button>
    </div>
  );
}
