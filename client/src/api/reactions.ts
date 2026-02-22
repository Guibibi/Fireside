import { del, get, post } from "./http";

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji_id: string | null;
  unicode_emoji: string | null;
}

export interface ReactionSummary {
  emoji_id: string | null;
  unicode_emoji: string | null;
  shortcode: string | null;
  count: number;
  user_reacted: boolean;
}

export interface ReactionDetailUser {
  user_id: string;
  username: string;
  display_name: string;
}

export interface MessageReactionDetail {
  emoji_id: string | null;
  unicode_emoji: string | null;
  shortcode: string | null;
  users: ReactionDetailUser[];
}

export interface AddReactionRequest {
  emoji_id?: string;
  unicode_emoji?: string;
}

export async function addReaction(
  messageId: string,
  request: AddReactionRequest
): Promise<Reaction> {
  return post<Reaction>(`/messages/${messageId}/reactions`, request);
}

export async function removeCustomReaction(
  messageId: string,
  emojiId: string
): Promise<void> {
  return del(`/messages/${messageId}/reactions/${emojiId}`);
}

export async function removeUnicodeReaction(
  messageId: string,
  unicodeEmoji: string
): Promise<void> {
  return del(`/messages/${messageId}/reactions/unicode/${encodeURIComponent(unicodeEmoji)}`);
}

export async function addDmReaction(
  messageId: string,
  request: AddReactionRequest
): Promise<Reaction> {
  return post<Reaction>(`/dm-messages/${messageId}/reactions`, request);
}

export async function removeDmCustomReaction(
  messageId: string,
  emojiId: string
): Promise<void> {
  return del(`/dm-messages/${messageId}/reactions/${emojiId}`);
}

export async function removeDmUnicodeReaction(
  messageId: string,
  unicodeEmoji: string
): Promise<void> {
  return del(`/dm-messages/${messageId}/reactions/unicode/${encodeURIComponent(unicodeEmoji)}`);
}

export async function getMessageReactionDetails(messageId: string): Promise<MessageReactionDetail[]> {
  return get<MessageReactionDetail[]>(`/messages/${messageId}/reactions`);
}

export async function getDmMessageReactionDetails(messageId: string): Promise<MessageReactionDetail[]> {
  return get<MessageReactionDetail[]>(`/dm-messages/${messageId}/reactions`);
}
