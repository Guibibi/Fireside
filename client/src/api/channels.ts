import { get, post } from "./http";
import type { Channel } from "../stores/chat";

export interface ChannelWithUnread extends Channel {
  unread_count: number;
}

export function listChannels() {
  return get<ChannelWithUnread[]>("/channels");
}

export function markChannelRead(channelId: string, lastReadMessageId: string | null = null) {
  return post<{ ok: boolean }>(`/channels/${channelId}/read`, {
    last_read_message_id: lastReadMessageId,
  });
}
