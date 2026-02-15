import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";
import { get } from "../api/http";

interface MessageRichContentProps {
  content: string;
}

interface EmbedPreview {
  url: string;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  site_name?: string | null;
}

interface LinkSegment {
  type: "link";
  href: string;
  text: string;
}

interface TextSegment {
  type: "text";
  text: string;
}

type ContentSegment = LinkSegment | TextSegment;

interface EmbedLoadState {
  status: "loading" | "ready" | "error";
  embed?: EmbedPreview;
}

const embedCache = new Map<string, EmbedLoadState>();
const EMBED_CACHE_MAX_ENTRIES = 300;

const URL_REGEX = /https?:\/\/[^\s<>"`]+/gi;
const MAX_EMBEDS_PER_MESSAGE = 3;

function trimTrailingPunctuation(url: string): { clean: string; trailing: string } {
  let end = url.length;

  while (end > 0) {
    const character = url[end - 1];
    if (character === "." || character === "," || character === "!" || character === "?" || character === ";" || character === ":") {
      end -= 1;
      continue;
    }

    if (character === ")") {
      const uptoEnd = url.slice(0, end);
      const openCount = (uptoEnd.match(/\(/g) ?? []).length;
      const closeCount = (uptoEnd.match(/\)/g) ?? []).length;
      if (closeCount > openCount) {
        end -= 1;
        continue;
      }
    }

    break;
  }

  return {
    clean: url.slice(0, end),
    trailing: url.slice(end),
  };
}

function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function splitMessageContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  URL_REGEX.lastIndex = 0;
  for (const match of content.matchAll(URL_REGEX)) {
    const raw = match[0];
    const matchIndex = match.index ?? 0;
    const { clean, trailing } = trimTrailingPunctuation(raw);
    const normalized = normalizeHttpUrl(clean);

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", text: content.slice(lastIndex, matchIndex) });
    }

    if (normalized) {
      segments.push({ type: "link", href: normalized, text: clean });
      if (trailing.length > 0) {
        segments.push({ type: "text", text: trailing });
      }
    } else {
      segments.push({ type: "text", text: raw });
    }

    lastIndex = matchIndex + raw.length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", text: content.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: "text", text: content });
  }

  return segments;
}

function extractUniqueUrls(content: string): string[] {
  const urls: string[] = [];
  const dedupe = new Set<string>();

  URL_REGEX.lastIndex = 0;
  for (const match of content.matchAll(URL_REGEX)) {
    const { clean } = trimTrailingPunctuation(match[0]);
    const normalized = normalizeHttpUrl(clean);
    if (!normalized || dedupe.has(normalized)) {
      continue;
    }

    dedupe.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function fallbackEmbedFor(url: string): EmbedPreview | null {
  try {
    const parsed = new URL(url);
    const site = parsed.hostname || parsed.host || url;
    return {
      url,
      title: site,
      description: null,
      image_url: null,
      site_name: site,
    };
  } catch {
    return null;
  }
}

function getCachedEmbed(url: string): EmbedLoadState | undefined {
  const cached = embedCache.get(url);
  if (!cached) {
    return undefined;
  }

  embedCache.delete(url);
  embedCache.set(url, cached);
  return cached;
}

function setCachedEmbed(url: string, state: EmbedLoadState): void {
  if (embedCache.has(url)) {
    embedCache.delete(url);
  }
  embedCache.set(url, state);

  if (embedCache.size <= EMBED_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldest = embedCache.keys().next().value;
  if (oldest) {
    embedCache.delete(oldest);
  }
}

function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id || null;
      }

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed") {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export default function MessageRichContent(props: MessageRichContentProps) {
  const segments = createMemo(() => splitMessageContent(props.content));
  const previewUrls = createMemo(() => extractUniqueUrls(props.content).slice(0, MAX_EMBEDS_PER_MESSAGE));
  const [embedsByUrl, setEmbedsByUrl] = createSignal<Record<string, EmbedLoadState>>({});
  const [playingVideos, setPlayingVideos] = createSignal<Record<string, boolean>>({});
  const [isLoadingEmbeds, setIsLoadingEmbeds] = createSignal(false);

  async function loadEmbeds(candidateUrls: string[]) {
    if (isLoadingEmbeds()) {
      return;
    }

    const existingByUrl = untrack(embedsByUrl);
    const urlsToFetch = candidateUrls.filter((url) => !existingByUrl[url]);

    if (urlsToFetch.length === 0) {
      return;
    }

    setIsLoadingEmbeds(true);
    for (const url of urlsToFetch) {
      setCachedEmbed(url, { status: "loading" });
      setEmbedsByUrl((current) => ({
        ...current,
        [url]: { status: "loading" },
      }));
    }

    await Promise.all(urlsToFetch.map(async (url) => {
      try {
        const embed = await get<EmbedPreview>(`/embeds?url=${encodeURIComponent(url)}`);
        setCachedEmbed(url, { status: "ready", embed });
        setEmbedsByUrl((current) => ({
          ...current,
          [url]: { status: "ready", embed },
        }));
      } catch {
        const fallback = fallbackEmbedFor(url);
        if (fallback) {
          setCachedEmbed(url, { status: "ready", embed: fallback });
          setEmbedsByUrl((current) => ({
            ...current,
            [url]: { status: "ready", embed: fallback },
          }));
          return;
        }

        setCachedEmbed(url, { status: "error" });
        setEmbedsByUrl((current) => ({
          ...current,
          [url]: { status: "error" },
        }));
      }
    }));

    setIsLoadingEmbeds(false);
  }

  createEffect(() => {
    const urls = previewUrls();
    if (urls.length === 0) {
      return;
    }

    const cached: Record<string, EmbedLoadState> = {};
    for (const url of urls) {
      const state = getCachedEmbed(url);
      if (state) {
        cached[url] = state;
      }
    }

    if (Object.keys(cached).length > 0) {
      setEmbedsByUrl((current) => ({ ...cached, ...current }));
    }

    void loadEmbeds(urls);
  });

  return (
    <>
      <p class="message-content">
        <For each={segments()}>
          {(segment) => (
            segment.type === "link"
              ? (
                <a class="message-link" href={segment.href} target="_blank" rel="noopener noreferrer nofollow ugc">
                  {segment.text}
                </a>
              )
              : segment.text
          )}
        </For>
      </p>

      <Show when={previewUrls().length > 0}>
        <div class="message-embeds">
          <For each={previewUrls()}>
            {(url) => {
              const state = createMemo(() => embedsByUrl()[url]);
              return (
                <Show
                  when={state()?.status === "ready" && state()?.embed}
                  fallback={(
                    <div class="message-embed-card message-embed-card-muted">
                      <p class="message-embed-title-text">
                        {state()?.status === "loading" ? "Loading preview..." : "Preview unavailable"}
                      </p>
                      <p class="message-embed-url">{url}</p>
                      <Show when={state()?.status === "error"}>
                        <button
                          type="button"
                          class="message-embed-retry"
                          onClick={() => {
                            embedCache.delete(url);
                            setEmbedsByUrl((current) => {
                              const next = { ...current };
                              delete next[url];
                              return next;
                            });
                            void loadEmbeds([url]);
                          }}
                        >
                          Retry
                        </button>
                      </Show>
                    </div>
                  )}
                >
                  <article class="message-embed-card">
                    <Show
                      when={extractYouTubeVideoId(state()?.embed?.url ?? url)}
                      fallback={(
                        <Show when={state()?.embed?.image_url}>
                          <img
                            class="message-embed-image"
                            src={state()?.embed?.image_url ?? ""}
                            alt="Link preview"
                            loading="lazy"
                            decoding="async"
                          />
                        </Show>
                      )}
                    >
                      {(videoId) => {
                        const isPlaying = createMemo(() => !!playingVideos()[url]);
                        return (
                          <Show
                            when={isPlaying()}
                            fallback={(
                              <button
                                type="button"
                                class="message-embed-video-start"
                                onClick={() => {
                                  setPlayingVideos((current) => ({
                                    ...current,
                                    [url]: true,
                                  }));
                                }}
                                aria-label="Play YouTube video"
                              >
                                <Show when={state()?.embed?.image_url}>
                                  <img
                                    class="message-embed-image"
                                    src={state()?.embed?.image_url ?? ""}
                                    alt="YouTube video preview"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </Show>
                                <span class="message-embed-video-play-icon" aria-hidden="true">▶</span>
                              </button>
                            )}
                          >
                            <div class="message-embed-video-frame-wrap">
                              <iframe
                                class="message-embed-video-frame"
                                src={`https://www.youtube-nocookie.com/embed/${videoId()}?autoplay=1&rel=0&modestbranding=1`}
                                title="YouTube video player"
                                loading="lazy"
                                referrerPolicy="strict-origin-when-cross-origin"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowfullscreen
                              />
                            </div>
                          </Show>
                        );
                      }}
                    </Show>
                    <div class="message-embed-body">
                      <Show when={state()?.embed?.site_name}>
                        <p class="message-embed-site">{state()?.embed?.site_name}</p>
                      </Show>
                      <a
                        class="message-embed-title"
                        href={state()?.embed?.url ?? url}
                        target="_blank"
                        rel="noopener noreferrer nofollow ugc"
                      >
                        {state()?.embed?.title ?? state()?.embed?.url ?? url}
                      </a>
                      <Show when={state()?.embed?.description}>
                        <p class="message-embed-description">{state()?.embed?.description}</p>
                      </Show>
                    </div>
                  </article>
                </Show>
              );
            }}
          </For>
          <Show when={isLoadingEmbeds()}>
            <p class="message-embed-loading-indicator">Loading previews...</p>
          </Show>
        </div>
      </Show>
    </>
  );
}
