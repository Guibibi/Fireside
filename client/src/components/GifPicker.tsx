import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { searchGifs, type GifResult } from "../api/gifs";
import "../styles/gif-picker.css";

interface GifPickerProps {
  onSelect: (gif: GifResult) => void;
  onClose: () => void;
  anchorRef?: HTMLElement;
}

export default function GifPicker(props: GifPickerProps) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<GifResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [position, setPosition] = createSignal({ top: 0, left: 0 });

  let searchTimeout: number | null = null;
  let pickerRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;

  const updatePosition = () => {
    if (!props.anchorRef || !pickerRef) {
      return;
    }

    const anchorRect = props.anchorRef.getBoundingClientRect();
    const pickerRect = pickerRef.getBoundingClientRect();
    const spacing = 8;
    let left = anchorRect.left + (anchorRect.width - pickerRect.width) / 2;
    left = Math.max(spacing, Math.min(left, window.innerWidth - pickerRect.width - spacing));

    let top = anchorRect.top - pickerRect.height - spacing;
    if (top < spacing) {
      top = anchorRect.bottom + spacing;
    }

    setPosition({ top, left });
  };

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (pickerRef?.contains(target)) {
        return;
      }

      if (props.anchorRef?.contains(target)) {
        return;
      }

      props.onClose();
    };

    const onReposition = () => {
      updatePosition();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    queueMicrotask(updatePosition);

    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);

      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    });
  });

  createEffect(() => {
    queueMicrotask(() => {
      searchInputRef?.focus();
    });
  });

  const performSearch = async (searchQuery: string, cursor?: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await searchGifs(searchQuery, 20, cursor);

      if (cursor) {
        setResults((prev) => [...prev, ...response.results]);
      } else {
        setResults(response.results);
      }

      setNextCursor(response.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search GIFs");
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);

    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = window.setTimeout(() => {
      performSearch(value);
    }, 300);
  };

  const handleLoadMore = () => {
    const cursor = nextCursor();
    if (cursor) {
      performSearch(query(), cursor);
    }
  };

  return (
    <div
      ref={pickerRef}
      class="gif-picker"
      style={{
        position: "fixed",
        top: `${position().top}px`,
        left: `${position().left}px`,
      }}
    >
      <div class="gif-picker-header">
        <input
          ref={searchInputRef}
          type="text"
          class="gif-picker-search"
          placeholder="Search GIFs..."
          value={query()}
          onInput={(e) => handleQueryChange(e.currentTarget.value)}
        />
      </div>

      <div class="gif-picker-content">
        <Show when={loading() && results().length === 0}>
          <div class="gif-picker-loading">Searching...</div>
        </Show>

        <Show when={error()}>
          <div class="gif-picker-error">{error()}</div>
        </Show>

        <Show when={!loading() && results().length === 0 && query()}>
          <div class="gif-picker-empty">No GIFs found</div>
        </Show>

        <div class="gif-grid">
          <For each={results()}>
            {(gif) => (
              <button
                type="button"
                class="gif-item"
                onClick={() => {
                  props.onSelect(gif);
                  props.onClose();
                }}
              >
                <img
                  src={gif.preview_url}
                  alt={gif.description || "GIF"}
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "auto",
                    "aspect-ratio": `${gif.width} / ${gif.height}`,
                  }}
                />
              </button>
            )}
          </For>
        </div>

        <Show when={nextCursor() && !loading()}>
          <button type="button" class="gif-load-more" onClick={handleLoadMore}>
            Load more
          </button>
        </Show>

        <Show when={loading() && results().length > 0}>
          <div class="gif-picker-loading-more">Loading...</div>
        </Show>
      </div>

      <div class="gif-picker-footer">
        <span>Powered by Klipy</span>
      </div>
    </div>
  );
}
