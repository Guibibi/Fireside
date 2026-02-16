import type { MessageAttachment } from "../api/ws";

export interface MessageReaction {
  emoji_id: string | null;
  unicode_emoji: string | null;
  shortcode: string | null;
  count: number;
  user_reacted: boolean;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
}

export interface MessageDayGroup {
  key: string;
  label: string;
  messages: ChannelMessage[];
}

export interface UsersResponse {
  users?: {
    username: string;
    display_name: string;
    avatar_url: string | null;
    profile_description?: string | null;
    profile_status?: string | null;
  }[];
}

export interface PendingAttachment {
  client_id: string;
  media_id: string | null;
  filename: string;
  mime_type: string;
  status: "uploading" | "processing" | "ready" | "failed";
  error: string | null;
}

export function getMessageDayKey(createdAt: string): string {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatMessageDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === -1) {
    return "Yesterday";
  }

  return date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function typingText(usernames: string[]): string {
  if (usernames.length === 0) {
    return "";
  }

  if (usernames.length === 1) {
    return `${usernames[0]} is typing...`;
  }

  if (usernames.length === 2) {
    return `${usernames[0]} and ${usernames[1]} are typing...`;
  }

  return `${usernames[0]}, ${usernames[1]}, and ${usernames.length - 2} others are typing...`;
}
