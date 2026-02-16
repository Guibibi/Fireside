import { createStore } from "solid-js/store";
import type { Emoji } from "../api/emojis";
import { listEmojis } from "../api/emojis";

interface EmojiStore {
  emojis: Emoji[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const [emojiStore, setEmojiStore] = createStore<EmojiStore>({
  emojis: [],
  loading: false,
  loaded: false,
  error: null,
});

let loadEmojisPromise: Promise<void> | null = null;

export function useEmojiStore() {
  return {
    get emojis() {
      return emojiStore.emojis;
    },
    get loading() {
      return emojiStore.loading;
    },
    get loaded() {
      return emojiStore.loaded;
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

export async function loadEmojis(options?: { force?: boolean }) {
  const force = options?.force ?? false;

  if (!force && emojiStore.loaded) {
    return;
  }

  if (loadEmojisPromise) {
    return loadEmojisPromise;
  }

  setEmojiStore("loading", true);
  setEmojiStore("error", null);

  loadEmojisPromise = (async () => {
    try {
      const emojis = await listEmojis();
      setEmojiStore("emojis", emojis);
      setEmojiStore("loaded", true);
    } catch (error) {
      setEmojiStore("error", error instanceof Error ? error.message : "Failed to load emojis");
    } finally {
      setEmojiStore("loading", false);
      loadEmojisPromise = null;
    }
  })();

  return loadEmojisPromise;
}

export function addEmojiToStore(emoji: Emoji) {
  setEmojiStore("emojis", (existing) => [...existing, emoji]);
}

export function removeEmojiFromStore(emojiId: string) {
  setEmojiStore("emojis", (existing) => existing.filter((e) => e.id !== emojiId));
}
