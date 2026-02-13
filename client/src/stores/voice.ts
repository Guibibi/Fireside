import { createSignal } from "solid-js";
import {
  type CameraStateSnapshot,
  type ScreenShareStateSnapshot,
  type RemoteVideoTile,
  subscribeCameraState,
  subscribeScreenState,
  subscribeVideoTiles,
} from "../api/media";

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
const [cameraEnabled, setCameraEnabled] = createSignal(false);
const [cameraError, setCameraError] = createSignal<string | null>(null);
const [localVideoStream, setLocalVideoStream] = createSignal<MediaStream | null>(null);
const [screenShareEnabled, setScreenShareEnabled] = createSignal(false);
const [screenShareError, setScreenShareError] = createSignal<string | null>(null);
const [localScreenShareStream, setLocalScreenShareStream] = createSignal<MediaStream | null>(null);
const [screenShareRoutingMode, setScreenShareRoutingMode] = createSignal<"sfu" | null>(null);
const [videoTiles, setVideoTiles] = createSignal<RemoteVideoTile[]>([]);
let unsubscribeVideoTiles: (() => void) | null = null;
let unsubscribeCameraState: (() => void) | null = null;
let unsubscribeScreenState: (() => void) | null = null;

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

export function removeVoiceChannelState(channelId: string) {
  setParticipantsByChannel((current) => {
    if (!current[channelId]) {
      return current;
    }

    const next = { ...current };
    delete next[channelId];
    return next;
  });

  setSpeakingByChannel((current) => {
    if (!current[channelId]) {
      return current;
    }

    const next = { ...current };
    delete next[channelId];
    return next;
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

export function setVoiceCameraError(error: string | null) {
  setCameraError(error);
}

export function clearVoiceCameraError() {
  setCameraError(null);
}

export function startVideoTilesSubscription() {
  if (unsubscribeVideoTiles) {
    return;
  }

  unsubscribeVideoTiles = subscribeVideoTiles((tiles) => {
    setVideoTiles(tiles);
  });
}

function applyCameraStateSnapshot(snapshot: CameraStateSnapshot) {
  setCameraEnabled(snapshot.enabled);
  setCameraError(snapshot.error);
  setLocalVideoStream(snapshot.stream);
}

function applyScreenStateSnapshot(snapshot: ScreenShareStateSnapshot) {
  setScreenShareEnabled(snapshot.enabled);
  setScreenShareError(snapshot.error);
  setLocalScreenShareStream(snapshot.stream);
  setScreenShareRoutingMode(snapshot.routingMode);
}

export function startCameraStateSubscription() {
  if (unsubscribeCameraState) {
    return;
  }

  unsubscribeCameraState = subscribeCameraState((snapshot) => {
    applyCameraStateSnapshot(snapshot);
  });
}

export function startScreenStateSubscription() {
  if (unsubscribeScreenState) {
    return;
  }

  unsubscribeScreenState = subscribeScreenState((snapshot) => {
    applyScreenStateSnapshot(snapshot);
  });
}

export function stopCameraStateSubscription() {
  if (unsubscribeCameraState) {
    unsubscribeCameraState();
    unsubscribeCameraState = null;
  }
}

export function stopScreenStateSubscription() {
  if (unsubscribeScreenState) {
    unsubscribeScreenState();
    unsubscribeScreenState = null;
  }
}

export function stopVideoTilesSubscription() {
  if (unsubscribeVideoTiles) {
    unsubscribeVideoTiles();
    unsubscribeVideoTiles = null;
  }

  setVideoTiles([]);
}

export function resetVoiceMediaState() {
  stopVideoTilesSubscription();
  stopCameraStateSubscription();
  stopScreenStateSubscription();
  setCameraEnabled(false);
  setCameraError(null);
  setLocalVideoStream(null);
  setScreenShareEnabled(false);
  setScreenShareError(null);
  setLocalScreenShareStream(null);
  setScreenShareRoutingMode(null);
}

export function resetVoiceState() {
  setJoinedVoiceChannelId(null);
  setParticipantsByChannel({});
  setSpeakingByChannel({});
  setVoiceActionState("idle");
  setMicMuted(false);
  setSpeakerMuted(false);
  setVoiceRejoinNotice(false);
  resetVoiceMediaState();
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
  cameraEnabled,
  cameraError,
  joinedVoiceChannelId,
  localVideoStream,
  localScreenShareStream,
  participantsByChannel,
  screenShareEnabled,
  screenShareError,
  screenShareRoutingMode,
  speakingByChannel,
  videoTiles,
  voiceActionState,
  setVoiceActionState,
  micMuted,
  speakerMuted,
  voiceRejoinNotice,
};
