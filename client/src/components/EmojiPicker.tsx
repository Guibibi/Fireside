import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { useEmojiStore, loadEmojis } from "../stores/emojis";
import type { Emoji } from "../api/emojis";
import "../styles/emoji-picker.css";

const COMMON_UNICODE_EMOJIS = [
  "😀", "😂", "🥰", "😍", "🤔", "😎", "😭", "😡",
  "👍", "👎", "👏", "🙏", "🔥", "❤️", "💯", "✨",
  "🎉", "🚀", "💀", "🤡", "💩", "🤮", "🤯", "🥳",
];

interface EmojiPickerProps {
  onSelect: (emoji: { type: "custom"; emoji: Emoji } | { type: "unicode"; emoji: string }) => void;
  onClose: () => void;
  anchorRef?: HTMLElement;
}

export default function EmojiPicker(props: EmojiPickerProps) {
  const emojiStore = useEmojiStore();
  const [activeTab, setActiveTab] = createSignal<"unicode" | "custom">("unicode");
  const [search, setSearch] = createSignal("");
  const [position, setPosition] = createSignal({ top: 0, left: 0 });

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
    if (!emojiStore.loaded && !emojiStore.loading) {
      void loadEmojis();
    }
  });

  createEffect(() => {
    queueMicrotask(() => {
      searchInputRef?.focus();
    });
  });

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
    });
  });

  const filteredCustomEmojis = () => {
    const query = search().toLowerCase();
    if (!query) return emojiStore.emojis;
    return emojiStore.emojis.filter(
      (e) =>
        e.shortcode.toLowerCase().includes(query) ||
        e.name.toLowerCase().includes(query)
    );
  };

  const filteredUnicodeEmojis = () => {
    const query = search().toLowerCase();
    if (!query) return COMMON_UNICODE_EMOJIS;
    return COMMON_UNICODE_EMOJIS.filter((e) => e.includes(query));
  };

  return (
    <div
      ref={pickerRef}
      class="emoji-picker"
      style={{
        position: "fixed",
        top: `${position().top}px`,
        left: `${position().left}px`,
      }}
    >
      <div class="emoji-picker-header">
        <div class="emoji-picker-tabs">
          <button
            type="button"
            class={`emoji-picker-tab${activeTab() === "unicode" ? " active" : ""}`}
            onClick={() => setActiveTab("unicode")}
          >
            Emoji
          </button>
          <button
            type="button"
            class={`emoji-picker-tab${activeTab() === "custom" ? " active" : ""}`}
            onClick={() => setActiveTab("custom")}
          >
            Custom
          </button>
        </div>
        <input
          ref={searchInputRef}
          type="text"
          class="emoji-picker-search"
          placeholder="Search..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      <div class="emoji-picker-content">
        <Show when={activeTab() === "unicode"}>
          <div class="emoji-grid">
            <For each={filteredUnicodeEmojis()}>
              {(emoji) => (
                <button
                  type="button"
                  class="emoji-item"
                  onClick={() => {
                    props.onSelect({ type: "unicode", emoji });
                    props.onClose();
                  }}
                  title={emoji}
                >
                  {emoji}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={activeTab() === "custom"}>
          <Show when={emojiStore.loading}>
            <div class="emoji-picker-loading">Loading...</div>
          </Show>
          <Show when={!emojiStore.loading && emojiStore.emojis.length === 0}>
            <div class="emoji-picker-empty">No custom emojis yet</div>
          </Show>
          <div class="emoji-grid">
            <For each={filteredCustomEmojis()}>
              {(emoji) => (
                <button
                  type="button"
                  class="emoji-item custom"
                  onClick={() => {
                    props.onSelect({ type: "custom", emoji });
                    props.onClose();
                  }}
                  title={`:${emoji.shortcode}:`}
                >
                  <img src={emoji.url} alt={`:${emoji.shortcode}:`} loading="lazy" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
