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

function toAbsoluteEmojiUrl(path: string): string {
  const normalizedPath = path
    .trim()
    .replace(/\/display\/?(\?.*)?$/i, (_match, query: string | undefined) => `/original${query ?? ""}`);

  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  const apiBaseUrl = getApiBaseUrl().replace(/\/+$/, "");
  const serverBaseUrl = apiBaseUrl.replace(/\/api$/i, "");

  if (/^\/api(\/|$)/i.test(normalizedPath)) {
    return `${serverBaseUrl}${normalizedPath}`;
  }

  if (normalizedPath.startsWith("/")) {
    return `${apiBaseUrl}${normalizedPath}`;
  }

  if (/^api(\/|$)/i.test(normalizedPath)) {
    return `${serverBaseUrl}/${normalizedPath}`;
  }

  return `${apiBaseUrl}/${normalizedPath}`;
}

function normalizeEmojiUrls<T extends { url: string }>(emoji: T): T {
  return {
    ...emoji,
    url: toAbsoluteEmojiUrl(emoji.url),
  };
}

export async function listEmojis(): Promise<Emoji[]> {
  const emojis = await get<Emoji[]>("/emojis");
  return emojis.map((emoji) => normalizeEmojiUrls(emoji));
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

  const created = await res.json() as CreateEmojiResponse;
  return normalizeEmojiUrls(created);
}

export async function deleteEmoji(emojiId: string): Promise<void> {
  return del(`/emojis/${emojiId}`);
}
