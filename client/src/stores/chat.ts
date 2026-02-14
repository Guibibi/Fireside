import { createSignal } from "solid-js";

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  kind: "text" | "voice";
  position: number;
  created_at: string;
}

const [activeChannelId, setActiveChannelId] = createSignal<string | null>(null);
const [unreadByChannel, setUnreadByChannel] = createSignal<Record<string, number>>({});

export function unreadCount(channelId: string): number {
  return unreadByChannel()[channelId] ?? 0;
}

export function incrementUnread(channelId: string) {
  setUnreadByChannel((current) => ({
    ...current,
    [channelId]: (current[channelId] ?? 0) + 1,
  }));
}

export function clearUnread(channelId: string) {
  setUnreadByChannel((current) => {
    if (!current[channelId]) {
      return current;
    }

    const next = { ...current };
    delete next[channelId];
    return next;
  });
}

export function removeUnreadChannel(channelId: string) {
  clearUnread(channelId);
}

export function resetChatState() {
  setActiveChannelId(null);
  setUnreadByChannel({});
}

export { activeChannelId, setActiveChannelId };
