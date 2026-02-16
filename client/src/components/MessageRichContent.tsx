import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { get } from "../api/http";
import { ZoomIcon, CloseIcon, DownloadIcon, ExternalLinkIcon } from "./icons";

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

interface ImagePreview {
  displayUrl: string;
  originalUrl: string;
}

interface InlineImageEntry {
  sourceUrl: string;
  imageUrl: string;
}

const embedCache = new Map<string, EmbedLoadState>();
const EMBED_CACHE_MAX_ENTRIES = 300;

const URL_REGEX = /https?:\/\/[^\s<>"`]+/gi;
const MAX_EMBEDS_PER_MESSAGE = 3;
const IMAGE_PATH_EXT_REGEX = /\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)$/;

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

function isDirectImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return IMAGE_PATH_EXT_REGEX.test(parsed.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeComparableUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isDirectImageEmbed(state: EmbedLoadState | undefined, sourceUrl: string): boolean {
  if (state?.status !== "ready" || !state.embed?.image_url) {
    return false;
  }

  const normalizedImage = normalizeComparableUrl(state.embed.image_url);
  const normalizedEmbedUrl = normalizeComparableUrl(state.embed.url ?? sourceUrl);
  const normalizedSourceUrl = normalizeComparableUrl(sourceUrl);

  if (!normalizedImage) {
    return false;
  }

  return normalizedImage === normalizedEmbedUrl || normalizedImage === normalizedSourceUrl;
}

export default function MessageRichContent(props: MessageRichContentProps) {
  const segments = createMemo(() => splitMessageContent(props.content));
  const previewUrls = createMemo(() => extractUniqueUrls(props.content).slice(0, MAX_EMBEDS_PER_MESSAGE));
  const embedCandidateUrls = createMemo(() => previewUrls().filter((url) => !isDirectImageUrl(url)));
  const [embedsByUrl, setEmbedsByUrl] = createSignal<Record<string, EmbedLoadState>>({});
  const [playingVideos, setPlayingVideos] = createSignal<Record<string, boolean>>({});
  const [isLoadingEmbeds, setIsLoadingEmbeds] = createSignal(false);
  const [imagePreview, setImagePreview] = createSignal<ImagePreview | null>(null);

  const inlineImageEntries = createMemo<InlineImageEntry[]>(() => {
    const entries: InlineImageEntry[] = [];
    const states = embedsByUrl();

    for (const url of previewUrls()) {
      if (isDirectImageUrl(url)) {
        entries.push({ sourceUrl: url, imageUrl: url });
        continue;
      }

      const state = states[url];
      if (isDirectImageEmbed(state, url) && state?.embed?.image_url) {
        entries.push({ sourceUrl: url, imageUrl: state.embed.image_url });
      }
    }

    return entries;
  });

  const embedUrls = createMemo(() => {
    const inlineSources = new Set(inlineImageEntries().map((entry) => entry.sourceUrl));
    return previewUrls().filter((url) => !inlineSources.has(url));
  });

  const hiddenLinkUrls = createMemo(() => {
    const urls = new Set<string>();
    for (const entry of inlineImageEntries()) {
      urls.add(entry.sourceUrl);
    }
    return urls;
  });

  const hasVisibleMessageContent = createMemo(() => segments().some((segment) => {
    if (segment.type === "text") {
      return segment.text.length > 0;
    }

    return !hiddenLinkUrls().has(segment.href);
  }));

  createEffect(() => {
    if (!imagePreview()) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setImagePreview(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    });
  });

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
    const urls = embedCandidateUrls();
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
      <Show when={hasVisibleMessageContent()}>
        <p class="message-content">
          <For each={segments()}>
            {(segment) => (
              segment.type === "link"
                ? (
                  <Show when={!hiddenLinkUrls().has(segment.href)}>
                    <a class="message-link" href={segment.href} target="_blank" rel="noopener noreferrer nofollow ugc">
                      {segment.text}
                    </a>
                  </Show>
                )
                : segment.text
            )}
          </For>
        </p>
      </Show>

      <Show when={previewUrls().length > 0}>
        <div class="message-embeds">
          <For each={inlineImageEntries()}>
            {(entry) => (
              <figure class="message-attachment" data-status="ready">
                <div class="message-attachment-media">
                  <button
                    type="button"
                    class="message-attachment-open"
                    onClick={() => {
                      setImagePreview({
                        displayUrl: entry.imageUrl,
                        originalUrl: entry.imageUrl,
                      });
                    }}
                    aria-label="Open image preview"
                    title="Open image preview"
                  >
                    <img src={entry.imageUrl} alt="Shared image link" loading="lazy" decoding="async" />
                  </button>
                  <button
                    type="button"
                    class="message-attachment-preview-overlay"
                    onClick={() => {
                      setImagePreview({
                        displayUrl: entry.imageUrl,
                        originalUrl: entry.imageUrl,
                      });
                    }}
                    aria-label="Open image preview"
                    title="Open image preview"
                  >
                    <ZoomIcon />
                  </button>
                </div>
              </figure>
            )}
          </For>
          <For each={embedUrls()}>
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
          <Show when={isLoadingEmbeds() && embedUrls().length > 0}>
            <p class="message-embed-loading-indicator">Loading previews...</p>
          </Show>
        </div>
      </Show>
      <Show when={imagePreview()}>
        <Portal>
          <div class="message-image-popup" role="presentation" onClick={() => setImagePreview(null)}>
            <div
              class="message-image-popup-content"
              role="dialog"
              aria-modal="true"
              aria-label="Image preview"
            >
              <div class="message-image-popup-stage" onClick={(event) => event.stopPropagation()}>
                <img src={imagePreview()?.displayUrl ?? ""} alt="Expanded chat image" loading="eager" decoding="async" />
                <div class="message-image-modal-actions" role="group" aria-label="Image actions">
                  <button
                    type="button"
                    class="message-image-modal-action"
                    onClick={() => setImagePreview(null)}
                    aria-label="Close preview"
                    title="Close"
                  >
                    <CloseIcon />
                  </button>
                  <a
                    class="message-image-modal-action"
                    href={imagePreview()?.originalUrl ?? "#"}
                    download="attachment"
                    aria-label="Download image"
                    title="Download"
                  >
                    <DownloadIcon />
                  </a>
                  <a
                    class="message-image-modal-action"
                    href={imagePreview()?.originalUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open full image in new tab"
                    title="Open full image"
                  >
                    <ExternalLinkIcon />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
