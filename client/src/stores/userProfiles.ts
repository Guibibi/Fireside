import { createSignal } from "solid-js";
import { serverUrl } from "./auth";

export interface UserProfile {
  username: string;
  display_name: string;
  avatar_url: string | null;
  profile_description?: string | null;
  profile_status?: string | null;
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

export function displayNameFor(username: string): string {
  const profile = profilesByUsername()[username];
  const displayName = profile?.display_name?.trim();
  return displayName && displayName.length > 0 ? displayName : username;
}

export function profileFor(username: string): UserProfile | null {
  return profilesByUsername()[username] ?? null;
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
        display_name: profile.display_name ?? existing?.display_name ?? profile.username,
        avatar_url: profile.avatar_url ?? existing?.avatar_url ?? null,
        profile_description: profile.profile_description !== undefined
          ? profile.profile_description
          : existing?.profile_description ?? null,
        profile_status: profile.profile_status !== undefined
          ? profile.profile_status
          : existing?.profile_status ?? null,
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
        display_name: existing?.display_name ?? username,
        avatar_url: avatarUrl,
      },
    };
  });
}

export function knownUsernames(): string[] {
  return Object.keys(profilesByUsername()).sort((left, right) => left.localeCompare(right));
}
