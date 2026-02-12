import { createSignal } from "solid-js";

export type VoiceActionState = "idle" | "joining" | "leaving";

export interface VoicePresenceChannel {
  channel_id: string;
  usernames: string[];
}

const [joinedVoiceChannelId, setJoinedVoiceChannelId] = createSignal<string | null>(null);
const [participantsByChannel, setParticipantsByChannel] = createSignal<Record<string, string[]>>({});
const [speakingByChannel, setSpeakingByChannel] = createSignal<Record<string, string[]>>({});
const [voiceActionState, setVoiceActionState] = createSignal<VoiceActionState>("idle");
const [micMuted, setMicMuted] = createSignal(false);
const [speakerMuted, setSpeakerMuted] = createSignal(false);
const [voiceRejoinNotice, setVoiceRejoinNotice] = createSignal(false);

function sortUnique(usernames: string[]): string[] {
  return [...new Set(usernames)].sort((a, b) => a.localeCompare(b));
}

export function applyVoiceSnapshot(channels: VoicePresenceChannel[]) {
  const next: Record<string, string[]> = {};
  for (const channel of channels) {
    next[channel.channel_id] = sortUnique(channel.usernames);
  }
  setParticipantsByChannel(next);
  setSpeakingByChannel({});
}

export function applyVoiceJoined(channelId: string, joinedUsername: string) {
  setParticipantsByChannel((current) => {
    const existing = current[channelId] ?? [];
    return {
      ...current,
      [channelId]: sortUnique([...existing, joinedUsername]),
    };
  });
}

export function applyVoiceLeft(channelId: string, leftUsername: string) {
  setParticipantsByChannel((current) => {
    const existing = current[channelId] ?? [];
    const nextUsers = existing.filter((username) => username !== leftUsername);

    if (nextUsers.length === 0) {
      const next = { ...current };
      delete next[channelId];
      return next;
    }

    return {
      ...current,
      [channelId]: nextUsers,
    };
  });

  setSpeakingByChannel((current) => {
    const existing = current[channelId] ?? [];
    const nextUsers = existing.filter((username) => username !== leftUsername);

    if (nextUsers.length === 0) {
      const next = { ...current };
      delete next[channelId];
      return next;
    }

    return {
      ...current,
      [channelId]: nextUsers,
    };
  });
}

export function applyVoiceSpeaking(channelId: string, username: string, speaking: boolean) {
  setSpeakingByChannel((current) => {
    const existing = current[channelId] ?? [];

    if (speaking) {
      if (existing.includes(username)) {
        return current;
      }

      return {
        ...current,
        [channelId]: sortUnique([...existing, username]),
      };
    }

    if (!existing.includes(username)) {
      return current;
    }

    const nextUsers = existing.filter((entry) => entry !== username);
    if (nextUsers.length === 0) {
      const next = { ...current };
      delete next[channelId];
      return next;
    }

    return {
      ...current,
      [channelId]: nextUsers,
    };
  });
}

export function isVoiceMemberSpeaking(channelId: string, username: string): boolean {
  return (speakingByChannel()[channelId] ?? []).includes(username);
}

export function participantsInChannel(channelId: string | null): string[] {
  if (!channelId) {
    return [];
  }

  return participantsByChannel()[channelId] ?? [];
}

export function setJoinedVoiceChannel(channelId: string | null) {
  setJoinedVoiceChannelId(channelId);
}

export function resetVoiceState() {
  setJoinedVoiceChannelId(null);
  setParticipantsByChannel({});
  setSpeakingByChannel({});
  setVoiceActionState("idle");
  setMicMuted(false);
  setSpeakerMuted(false);
  setVoiceRejoinNotice(false);
}

export function showVoiceRejoinNotice() {
  setVoiceRejoinNotice(true);
}

export function clearVoiceRejoinNotice() {
  setVoiceRejoinNotice(false);
}

export function toggleMicMuted() {
  setMicMuted((current) => !current);
}

export function toggleSpeakerMuted() {
  setSpeakerMuted((current) => !current);
}

export {
  joinedVoiceChannelId,
  participantsByChannel,
  speakingByChannel,
  voiceActionState,
  setVoiceActionState,
  micMuted,
  speakerMuted,
  voiceRejoinNotice,
};
