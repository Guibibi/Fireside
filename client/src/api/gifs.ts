import { get } from "./http";

export interface GifResult {
  id: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
  description: string | null;
}

export interface GifSearchResponse {
  results: GifResult[];
  next_cursor: string | null;
}

export async function searchGifs(
  query: string,
  limit: number = 20,
  cursor?: string
): Promise<GifSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
  });

  if (cursor) {
    params.append("cursor", cursor);
  }

  return get<GifSearchResponse>(`/gifs/search?${params.toString()}`);
}
