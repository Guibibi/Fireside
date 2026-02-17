import { del, get, patch, post } from "./http";
import type { ReactionSummary } from "./reactions";

export interface DmThreadSummary {
  thread_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_url: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface DmMessage {
  id: string;
  thread_id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
  reactions?: ReactionSummary[];
}

export function openDmWithUser(username: string) {
  return post<{ thread: DmThreadSummary }>(`/dms/with/${encodeURIComponent(username)}`);
}

export function listDmThreads() {
  return get<DmThreadSummary[]>("/dms");
}

export function fetchDmMessages(threadId: string, before?: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) {
    params.set("before", before);
  }
  return get<DmMessage[]>(`/dms/${threadId}/messages?${params.toString()}`);
}

export function sendDmMessage(threadId: string, content: string) {
  return post<DmMessage>(`/dms/${threadId}/messages`, { content });
}

export function editDmMessage(messageId: string, content: string) {
  return patch<DmMessage>(`/dm-messages/${messageId}`, { content });
}

export function deleteDmMessage(messageId: string) {
  return del<{ deleted: true }>(`/dm-messages/${messageId}`);
}

export function markDmRead(threadId: string, lastReadMessageId: string | null) {
  return post<{ ok: true }>(`/dms/${threadId}/read`, {
    last_read_message_id: lastReadMessageId,
  });
}
