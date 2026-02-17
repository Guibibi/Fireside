import { get, del } from "./http";
import { getApiBaseUrl, token } from "../stores/auth";

export interface Emoji {
  id: string;
  shortcode: string;
  name: string;
  url: string;
  created_by: string;
}

export interface CreateEmojiResponse {
  id: string;
  shortcode: string;
  name: string;
  media_id: string;
  url: string;
}

export async function listEmojis(): Promise<Emoji[]> {
  return get<Emoji[]>("/emojis");
}

export async function createEmoji(
  shortcode: string,
  name: string,
  file: File
): Promise<CreateEmojiResponse> {
  const formData = new FormData();
  formData.append("shortcode", shortcode);
  formData.append("name", name);
  formData.append("file", file);

  const headers: Record<string, string> = {};
  const currentToken = token();
  if (currentToken) {
    headers.Authorization = `Bearer ${currentToken}`;
  }

  const res = await fetch(`${getApiBaseUrl()}/emojis`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json();
}

export async function deleteEmoji(emojiId: string): Promise<void> {
  return del(`/emojis/${emojiId}`);
}
