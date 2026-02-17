import { For, Show, createEffect, createSignal, onMount, onCleanup } from "solid-js";
import { createEmoji, deleteEmoji } from "../../api/emojis";
import { errorMessage } from "../../utils/error";
import { loadEmojis, useEmojiStore } from "../../stores/emojis";

export interface EmojiSettingsProps {
  isOperatorOrAdmin: boolean;
}

export default function EmojiSettings(props: EmojiSettingsProps) {
  const emojiStore = useEmojiStore();
  const [shortcode, setShortcode] = createSignal("");
  const [name, setName] = createSignal("");
  const [file, setFile] = createSignal<File | null>(null);
  const [isUploading, setIsUploading] = createSignal(false);
  const [deletingEmojiId, setDeletingEmojiId] = createSignal<string | null>(null);
  const [formError, setFormError] = createSignal("");
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);

  let fileInputRef: HTMLInputElement | undefined;

  onMount(() => {
    void loadEmojis();
  });

  function resetForm() {
    setShortcode("");
    setName("");
    setFile(null);
    if (fileInputRef) {
      fileInputRef.value = "";
    }
  }

  createEffect(() => {
    const selected = file();
    if (!selected) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selected);
    setPreviewUrl(objectUrl);
    onCleanup(() => {
      URL.revokeObjectURL(objectUrl);
    });
  });

  function validateUpload(fileValue: File, shortcodeValue: string, nameValue: string): string | null {
    if (!shortcodeValue || shortcodeValue.length > 32) {
      return "Shortcode must be between 1 and 32 characters.";
    }

    if (!/^[a-zA-Z0-9_]+$/.test(shortcodeValue) || shortcodeValue.startsWith("_") || shortcodeValue.endsWith("_")) {
      return "Shortcode can only use letters, numbers, and underscores (no leading/trailing underscore).";
    }

    if (!nameValue || nameValue.length > 32) {
      return "Name must be between 1 and 32 characters.";
    }

    if (fileValue.size > 512 * 1024) {
      return "Emoji must be 512 KB or smaller.";
    }

    if (!["image/png", "image/webp", "image/gif"].includes(fileValue.type)) {
      return "Emoji must be PNG, WebP, or GIF.";
    }

    return null;
  }

  async function handleCreateEmoji(event: Event) {
    event.preventDefault();
    if (!props.isOperatorOrAdmin || isUploading()) {
      return;
    }

    const nextFile = file();
    if (!nextFile) {
      setFormError("Please choose an emoji file.");
      return;
    }

    const nextShortcode = shortcode().trim();
    const nextName = name().trim();
    const validationError = validateUpload(nextFile, nextShortcode, nextName);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setIsUploading(true);
    try {
      await createEmoji(nextShortcode, nextName, nextFile);
      resetForm();
      await loadEmojis({ force: true });
    } catch (error) {
      setFormError(errorMessage(error, "Failed to upload emoji"));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteEmoji(emojiId: string) {
    if (!props.isOperatorOrAdmin || deletingEmojiId()) {
      return;
    }

    if (!window.confirm("Delete this emoji?")) {
      return;
    }

    setFormError("");
    setDeletingEmojiId(emojiId);
    try {
      await deleteEmoji(emojiId);
      await loadEmojis({ force: true });
    } catch (error) {
      setFormError(errorMessage(error, "Failed to delete emoji"));
    } finally {
      setDeletingEmojiId(null);
    }
  }

  return (
    <section class="settings-section">
      <h5>Custom emojis</h5>
      <Show
        when={props.isOperatorOrAdmin}
        fallback={<p class="settings-help">Only operators/admins can manage server emojis.</p>}
      >
        <div class="emoji-settings-layout">
          <form class="settings-audio-row emoji-upload-card" onSubmit={(event) => void handleCreateEmoji(event)}>
            <h6 class="emoji-settings-card-title">Upload emoji</h6>

            <label class="settings-label" for="emoji-shortcode">Shortcode</label>
            <input
              id="emoji-shortcode"
              type="text"
              value={shortcode()}
              maxlength={32}
              placeholder="party_parrot"
              onInput={(event) => setShortcode(event.currentTarget.value)}
              disabled={isUploading()}
            />

            <label class="settings-label" for="emoji-name">Name</label>
            <input
              id="emoji-name"
              type="text"
              value={name()}
              maxlength={32}
              placeholder="Party Parrot"
              onInput={(event) => setName(event.currentTarget.value)}
              disabled={isUploading()}
            />

            <label class="settings-label" for="emoji-file">Emoji file</label>
            <input
              ref={fileInputRef}
              id="emoji-file"
              type="file"
              accept="image/png,image/webp,image/gif"
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0] ?? null;
                setFile(selected);
              }}
              disabled={isUploading()}
            />

            <Show when={previewUrl()}>
              <div class="emoji-upload-preview" role="status" aria-live="polite">
                <img src={previewUrl() ?? ""} alt="Emoji preview" />
                <div class="emoji-upload-preview-meta">
                  <p class="emoji-upload-preview-name">{file()?.name}</p>
                  <p class="emoji-upload-preview-size">{Math.max(1, Math.round((file()?.size ?? 0) / 1024))} KB</p>
                </div>
              </div>
            </Show>

            <p class="settings-help">PNG/WebP/GIF, up to 512 KB. Larger images are automatically resized to 128x128 max.</p>

            <div class="settings-actions">
              <button type="submit" disabled={isUploading()}>{isUploading() ? "Uploading..." : "Upload emoji"}</button>
            </div>
          </form>

          <div class="emoji-library-card">
            <div class="emoji-library-head">
              <h6 class="emoji-settings-card-title">Emoji library</h6>
              <Show when={emojiStore.emojis.length > 0}>
                <span class="emoji-library-count">{emojiStore.emojis.length} total</span>
              </Show>
            </div>

            <Show when={emojiStore.loading}>
              <p class="settings-help">Loading emojis...</p>
            </Show>

            <Show when={!emojiStore.loading && emojiStore.emojis.length === 0}>
              <p class="settings-help">No custom emojis uploaded yet.</p>
            </Show>

            <Show when={emojiStore.emojis.length > 0}>
              <ul class="emoji-settings-list">
                <For each={emojiStore.emojis}>
                  {(emoji) => (
                    <li class="emoji-settings-item">
                      <div class="emoji-settings-item-main">
                        <img src={emoji.url} alt={`:${emoji.shortcode}:`} loading="lazy" />
                        <div>
                          <p class="emoji-settings-shortcode">:{emoji.shortcode}:</p>
                          <p class="emoji-settings-name">{emoji.name}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="settings-secondary"
                        onClick={() => void handleDeleteEmoji(emoji.id)}
                        disabled={deletingEmojiId() === emoji.id}
                      >
                        {deletingEmojiId() === emoji.id ? "Deleting..." : "Delete"}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>

        <Show when={formError()}>
          <p class="error">{formError()}</p>
        </Show>
      </Show>
    </section>
  );
}
