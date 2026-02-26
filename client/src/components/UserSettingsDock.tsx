import { onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { username as currentUsername } from "../stores/auth";
import { openSettings } from "../stores/settings";
import { closeMobileNav } from "../stores/chat";
import UserAvatar from "./UserAvatar";
import { displayNameFor, upsertUserProfile } from "../stores/userProfiles";
import { getApiBaseUrl, role, token } from "../stores/auth";
import { hasPendingAppUpdate, startUpdaterPolling } from "../stores/updater";
import { ExternalLinkIcon, SettingsIcon } from "./icons";
import { isOperatorOrAdminRole } from "../utils/roles";

interface CurrentUserResponse {
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export default function UserSettingsDock() {
  const navigate = useNavigate();
  const currentUsernameValue = () => currentUsername();
  const canAccessAdminSettings = () => isOperatorOrAdminRole(role());

  function avatarFallbackLabel() {
    const usernameValue = currentUsernameValue()?.trim();
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
      upsertUserProfile({
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      });
    } catch {
      // no-op
    }
  }

  onMount(() => {
    void refreshCurrentUserProfile();
    const stopUpdaterPolling = startUpdaterPolling();
    onCleanup(stopUpdaterPolling);
  });

  return (
    <div class="user-dock">
      <UserAvatar username={currentUsername() ?? avatarFallbackLabel()} class="user-dock-avatar" size={42} />
      <div class="user-dock-meta">
        <p class="user-dock-name">
          {(() => {
            const usernameValue = currentUsernameValue();
            return usernameValue ? displayNameFor(usernameValue) : "Unknown user";
          })()}
        </p>
        <p class="user-dock-subtitle">Online</p>
      </div>
      <button
        type="button"
        class={`user-dock-settings${hasPendingAppUpdate() ? " user-dock-settings-has-update" : ""}`}
        onClick={() => {
          openSettings();
          closeMobileNav();
        }}
        aria-label={hasPendingAppUpdate() ? "Open settings, update available" : "Open settings"}
        title="Settings"
      >
        <SettingsIcon />
      </button>
      {canAccessAdminSettings() && (
        <button
          type="button"
          class="user-dock-settings"
          onClick={() => {
            closeMobileNav();
            navigate("/admin/settings");
          }}
          aria-label="Open admin settings"
          title="Admin settings"
        >
          <ExternalLinkIcon width={14} height={14} />
        </button>
      )}
    </div>
  );
}
