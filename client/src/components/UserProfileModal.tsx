import { Show, createResource, createSignal } from "solid-js";
import Modal from "./Modal";
import { get } from "../api/http";
import { openDmWithUser } from "../api/dms";
import { errorMessage } from "../utils/error";
import { closeProfileModal, profileModalUsername } from "../stores/profileModal";
import { setActiveDmThread } from "../stores/chat";
import { upsertDmThread } from "../stores/dms";
import UserAvatar from "./UserAvatar";

interface UserProfileResponse {
  username: string;
  display_name: string;
  avatar_url: string | null;
  profile_description: string | null;
  profile_status: string | null;
}

async function fetchProfile(username: string | null) {
  if (!username) {
    return null;
  }
  return get<UserProfileResponse>(`/users/${encodeURIComponent(username)}`);
}

export default function UserProfileModal() {
  const [profile, { refetch }] = createResource(profileModalUsername, fetchProfile);
  const [dmError, setDmError] = createSignal("");

  async function handleSendMessage() {
    const currentProfile = profile();
    if (!currentProfile) {
      return;
    }

    try {
      const response = await openDmWithUser(currentProfile.username);
      upsertDmThread(response.thread);
      setActiveDmThread(response.thread.thread_id);
      setDmError("");
      closeProfileModal();
    } catch (error) {
      setDmError(errorMessage(error, "Failed to open DM thread"));
    }
  }

  return (
    <Modal
      open={!!profileModalUsername()}
      onClose={closeProfileModal}
      title="User Profile"
      ariaLabel="User profile"
      modalClass="user-profile-modal"
    >
      <div class="user-profile-modal-content">
        <Show when={!profile.loading} fallback={<p class="settings-help">Loading profile...</p>}>
          <Show when={profile()} fallback={<p class="error">Profile not found</p>}>
            {(resolvedProfile) => (
              <>
                <div class="user-profile-header">
                  <UserAvatar username={resolvedProfile().username} size={64} />
                  <div class="user-profile-identity">
                    <h5>{resolvedProfile().display_name}</h5>
                    <p>@{resolvedProfile().username}</p>
                  </div>
                </div>

                <Show when={resolvedProfile().profile_status}>
                  <p class="user-profile-status">{resolvedProfile().profile_status}</p>
                </Show>

                <Show when={resolvedProfile().profile_description} fallback={<p class="settings-help">No profile description set.</p>}>
                  <p class="user-profile-description">{resolvedProfile().profile_description}</p>
                </Show>

                <Show when={dmError()}>
                  <p class="error">{dmError()}</p>
                </Show>

                <div class="settings-actions user-profile-actions">
                  <button type="button" onClick={() => void handleSendMessage()}>
                    Send Message
                  </button>
                  <button type="button" class="settings-secondary" onClick={() => void refetch()}>
                    Refresh
                  </button>
                </div>
              </>
            )}
          </Show>
        </Show>
      </div>
    </Modal>
  );
}
