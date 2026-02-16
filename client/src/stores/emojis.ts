import { createStore } from "solid-js/store";
import type { Emoji } from "../api/emojis";
import { listEmojis } from "../api/emojis";

interface EmojiStore {
  emojis: Emoji[];
  loading: boolean;
  error: string | null;
}

const [emojiStore, setEmojiStore] = createStore<EmojiStore>({
  emojis: [],
  loading: false,
  error: null,
});

export function useEmojiStore() {
  return {
    get emojis() {
      return emojiStore.emojis;
    },
    get loading() {
      return emojiStore.loading;
    },
    get error() {
      return emojiStore.error;
    },
    getEmojiByShortcode(shortcode: string): Emoji | undefined {
      return emojiStore.emojis.find((e) => e.shortcode === shortcode);
    },
    getEmojiById(id: string): Emoji | undefined {
      return emojiStore.emojis.find((e) => e.id === id);
    },
  };
}

export async function loadEmojis() {
  setEmojiStore("loading", true);
  setEmojiStore("error", null);

  try {
    const emojis = await listEmojis();
    setEmojiStore("emojis", emojis);
  } catch (error) {
    setEmojiStore("error", error instanceof Error ? error.message : "Failed to load emojis");
  } finally {
    setEmojiStore("loading", false);
  }
}

export function addEmojiToStore(emoji: Emoji) {
  setEmojiStore("emojis", (existing) => [...existing, emoji]);
}

export function removeEmojiFromStore(emojiId: string) {
  setEmojiStore("emojis", (existing) => existing.filter((e) => e.id !== emojiId));
}
