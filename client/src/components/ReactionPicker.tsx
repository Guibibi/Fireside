import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { useEmojiStore, loadEmojis } from "../stores/emojis";
import type { Emoji } from "../api/emojis";
import "../styles/reaction-picker.css";

const COMMON_UNICODE_EMOJIS = [
  "👍", "👎", "😀", "😂", "😍", "🤔", "😎", "😭",
  "😡", "❤️", "🔥", "✨", "🎉", "🚀", "👏", "🙏",
];

interface ReactionPickerProps {
  onSelect: (emoji: { type: "custom"; emoji: Emoji } | { type: "unicode"; emoji: string }) => void;
  onClose: () => void;
  anchorRef?: HTMLElement;
}

export default function ReactionPicker(props: ReactionPickerProps) {
  const emojiStore = useEmojiStore();
  const [showCustom, setShowCustom] = createSignal(false);
  const [position, setPosition] = createSignal({ top: 0, left: 0 });

  let pickerRef: HTMLDivElement | undefined;

  createEffect(() => {
    void loadEmojis();
  });

  const updatePosition = () => {
    if (!props.anchorRef || !pickerRef) {
      return;
    }

    const anchorRect = props.anchorRef.getBoundingClientRect();
    const pickerRect = pickerRef.getBoundingClientRect();
    const spacing = 8;
    const maxLeft = Math.max(spacing, window.innerWidth - pickerRect.width - spacing);
    const left = Math.min(Math.max(anchorRect.left, spacing), maxLeft);
    const top = Math.max(spacing, anchorRect.top - pickerRect.height - spacing);

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
    });
  });

  return (
    <div
      ref={pickerRef}
      class="reaction-picker"
      style={{
        position: "fixed",
        top: `${position().top}px`,
        left: `${position().left}px`,
        "z-index": "1000",
      }}
    >
      <div class="reaction-picker-content">
        <Show when={!showCustom()}>
          <div class="reaction-grid">
            <For each={COMMON_UNICODE_EMOJIS}>
              {(emoji) => (
                <button
                  type="button"
                  class="reaction-item"
                  onClick={(e) => {
                    e.stopPropagation();
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

          <Show when={emojiStore.emojis.length > 0}>
            <div class="reaction-picker-divider" />
            <div class="reaction-custom-header">
              <span>Server emojis</span>
              <button
                type="button"
                class="reaction-show-more"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCustom(true);
                }}
              >
                More
              </button>
            </div>
            <div class="reaction-grid">
              <For each={emojiStore.emojis.slice(0, 8)}>
                {(emoji) => (
                  <button
                    type="button"
                    class="reaction-item custom"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSelect({ type: "custom", emoji });
                      props.onClose();
                    }}
                    title={`:${emoji.shortcode}:`}
                  >
                    <img src={emoji.url} alt={`:${emoji.shortcode}:`} decoding="async" />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={showCustom()}>
          <div class="reaction-custom-header">
            <button
              type="button"
              class="reaction-back"
              onClick={(e) => {
                e.stopPropagation();
                setShowCustom(false);
              }}
            >
              ← Back
            </button>
          </div>
          <div class="reaction-grid">
            <For each={emojiStore.emojis}>
              {(emoji) => (
                <button
                  type="button"
                  class="reaction-item custom"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onSelect({ type: "custom", emoji });
                    props.onClose();
                  }}
                  title={`:${emoji.shortcode}:`}
                >
                  <img src={emoji.url} alt={`:${emoji.shortcode}:`} decoding="async" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
