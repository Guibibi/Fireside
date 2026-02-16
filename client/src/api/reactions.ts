import { post, del } from "./http";

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
