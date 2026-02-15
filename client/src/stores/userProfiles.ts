import { createSignal } from "solid-js";
import { serverUrl } from "./auth";

export interface UserProfile {
  username: string;
  avatar_url: string | null;
}

const [profilesByUsername, setProfilesByUsername] = createSignal<Record<string, UserProfile>>({});

function normalizeAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(avatarUrl)) {
    return avatarUrl;
  }

  return `${serverUrl()}${avatarUrl}`;
}

export function avatarUrlFor(username: string): string | null {
  const profile = profilesByUsername()[username];
  return normalizeAvatarUrl(profile?.avatar_url ?? null);
}

export function setUserProfiles(profiles: UserProfile[]) {
  const next: Record<string, UserProfile> = {};
  for (const profile of profiles) {
    next[profile.username] = profile;
  }
  setProfilesByUsername(next);
}

export function upsertUserProfile(profile: UserProfile) {
  setProfilesByUsername((current) => {
    const existing = current[profile.username];
    return {
      ...current,
      [profile.username]: {
        ...existing,
        ...profile,
        avatar_url: profile.avatar_url ?? existing?.avatar_url ?? null,
      },
    };
  });
}

export function setUserAvatar(username: string, avatarUrl: string | null) {
  setProfilesByUsername((current) => {
    const existing = current[username];
    return {
      ...current,
      [username]: {
        ...existing,
        username,
        avatar_url: avatarUrl,
      },
    };
  });
}

export function renameUserProfile(previousUsername: string, nextUsername: string) {
  setProfilesByUsername((current) => {
    const next = { ...current };
    const existing = next[previousUsername];
    if (existing) {
      delete next[previousUsername];
      next[nextUsername] = {
        ...existing,
        username: nextUsername,
      };
    }
    return next;
  });
}
