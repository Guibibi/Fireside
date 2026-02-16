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

  createEffect(() => {
    loadEmojis();
  });

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".reaction-picker")) {
        props.onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClickOutside);

    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClickOutside);
    });
  });

  const getAnchorPosition = () => {
    if (!props.anchorRef) return {};
    const rect = props.anchorRef.getBoundingClientRect();
    return {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`,
    };
  };

  return (
    <div
      class="reaction-picker"
      style={{
        position: "fixed",
        ...getAnchorPosition(),
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
                    <img src={emoji.url} alt={`:${emoji.shortcode}:`} loading="lazy" />
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
