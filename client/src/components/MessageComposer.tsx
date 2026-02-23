import { For, Show, createEffect, createMemo, createSignal, lazy, Suspense } from "solid-js";
import type { Emoji } from "../api/emojis";
import type { PendingAttachment } from "./messageTypes";
import type { GifResult } from "../api/gifs";
import { loadEmojis, useEmojiStore } from "../stores/emojis";

const EmojiPicker = lazy(() => import("./EmojiPicker"));
const GifPicker = lazy(() => import("./GifPicker"));

interface MessageComposerProps {
  activeChannelId: string | null;
  draft: string;
  isSending: boolean;
  savingMessageId: string | null;
  deletingMessageId: string | null;
  pendingAttachments: PendingAttachment[];
  hasBlockingAttachment: boolean;
  hasFailedAttachment: boolean;
  mentionUsernames: string[];
  onSubmit: (event: Event) => void;
  onDraftInput: (value: string) => void;
  onAttachmentInput: (event: Event) => void;
  onDraftPaste: (event: ClipboardEvent) => void;
  onRemoveAttachment: (clientId: string) => void;
  onGifSelect?: (gif: GifResult) => void;
}

export default function MessageComposer(props: MessageComposerProps) {
  const emojiStore = useEmojiStore();
  let fileInputRef: HTMLInputElement | undefined;
  let draftInputRef: HTMLInputElement | undefined;
  let emojiButtonRef: HTMLButtonElement | undefined;
  let gifButtonRef: HTMLButtonElement | undefined;

  const [mentionRange, setMentionRange] = createSignal<{ start: number; end: number } | null>(null);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [selectedMentionIndex, setSelectedMentionIndex] = createSignal(0);
  const [emojiRange, setEmojiRange] = createSignal<{ start: number; end: number } | null>(null);
  const [emojiQuery, setEmojiQuery] = createSignal("");
  const [selectedEmojiIndex, setSelectedEmojiIndex] = createSignal(0);
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false);
  const [showGifPicker, setShowGifPicker] = createSignal(false);

  createEffect(() => {
    if (!emojiStore.loaded && !emojiStore.loading) {
      void loadEmojis();
    }
  });

  function insertEmoji(emoji: string) {
    const input = draftInputRef;
    if (!input) return;

    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const newDraft = props.draft.slice(0, start) + emoji + props.draft.slice(end);
    props.onDraftInput(newDraft);

    queueMicrotask(() => {
      input.focus();
      const newCursor = start + emoji.length;
      input.setSelectionRange(newCursor, newCursor);
    });
  }

  function closeMentionPicker() {
    setMentionRange(null);
    setMentionQuery("");
    setSelectedMentionIndex(0);
  }

  function closeEmojiShortcodePicker() {
    setEmojiRange(null);
    setEmojiQuery("");
    setSelectedEmojiIndex(0);
  }

  function refreshMentionPicker(nextDraft: string, caretIndex: number | null | undefined) {
    if (caretIndex == null || caretIndex < 0) {
      closeMentionPicker();
      return;
    }

    let tokenStart = caretIndex - 1;
    while (tokenStart >= 0 && !/\s/.test(nextDraft[tokenStart])) {
      tokenStart -= 1;
    }

    tokenStart += 1;
    if (tokenStart >= caretIndex) {
      closeMentionPicker();
      return;
    }

    const token = nextDraft.slice(tokenStart, caretIndex);
    if (!token.startsWith("@") || !/^@[a-zA-Z0-9._-]*$/.test(token)) {
      closeMentionPicker();
      return;
    }

    const prefixCharacter = tokenStart > 0 ? nextDraft[tokenStart - 1] : "";
    if (prefixCharacter && /[a-zA-Z0-9._-]/.test(prefixCharacter)) {
      closeMentionPicker();
      return;
    }

    const nextQuery = token.slice(1);
    const currentRange = mentionRange();
    const currentQuery = mentionQuery();

    if (
      currentRange
      && currentRange.start === tokenStart
      && currentRange.end === caretIndex
      && currentQuery === nextQuery
    ) {
      return;
    }

    setMentionRange({ start: tokenStart, end: caretIndex });
    setMentionQuery(nextQuery);
    setSelectedMentionIndex(0);
  }

  function refreshEmojiShortcodePicker(nextDraft: string, caretIndex: number | null | undefined) {
    if (caretIndex == null || caretIndex < 0) {
      closeEmojiShortcodePicker();
      return;
    }

    let tokenStart = caretIndex - 1;
    while (tokenStart >= 0 && !/\s/.test(nextDraft[tokenStart])) {
      tokenStart -= 1;
    }

    tokenStart += 1;
    if (tokenStart >= caretIndex) {
      closeEmojiShortcodePicker();
      return;
    }

    const token = nextDraft.slice(tokenStart, caretIndex);
    if (!token.startsWith(":") || !/^:[a-zA-Z0-9_]*$/.test(token)) {
      closeEmojiShortcodePicker();
      return;
    }

    const prefixCharacter = tokenStart > 0 ? nextDraft[tokenStart - 1] : "";
    if (prefixCharacter && /[a-zA-Z0-9_]/.test(prefixCharacter)) {
      closeEmojiShortcodePicker();
      return;
    }

    const nextQuery = token.slice(1);
    const currentRange = emojiRange();
    const currentQuery = emojiQuery();

    if (
      currentRange
      && currentRange.start === tokenStart
      && currentRange.end === caretIndex
      && currentQuery === nextQuery
    ) {
      return;
    }

    setEmojiRange({ start: tokenStart, end: caretIndex });
    setEmojiQuery(nextQuery);
    setSelectedEmojiIndex(0);
  }

  const mentionSuggestions = createMemo(() => {
    const query = mentionQuery().trim().toLowerCase();
    const allUsers = props.mentionUsernames;
    const byPrefix = allUsers
      .filter((entry) => entry.toLowerCase().startsWith(query))
      .sort((left, right) => left.localeCompare(right));
    const byContain = allUsers
      .filter((entry) => !entry.toLowerCase().startsWith(query) && entry.toLowerCase().includes(query))
      .sort((left, right) => left.localeCompare(right));

    const suggestions = [...byPrefix, ...byContain].slice(0, 6);
    if (suggestions.length === 0) {
      return [];
    }

    return suggestions;
  });

  const emojiSuggestions = createMemo(() => {
    const allEmojis = [...emojiStore.emojis].sort((left, right) => left.shortcode.localeCompare(right.shortcode));
    if (allEmojis.length === 0) {
      return [];
    }

    const query = emojiQuery().trim().toLowerCase();
    if (!query) {
      return allEmojis.slice(0, 6);
    }

    const byPrefix = allEmojis.filter((entry) => entry.shortcode.toLowerCase().startsWith(query));
    const byContain = allEmojis.filter(
      (entry) => !entry.shortcode.toLowerCase().startsWith(query)
        && (entry.shortcode.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query)),
    );

    return [...byPrefix, ...byContain].slice(0, 6);
  });

  function applyMention(username: string) {
    const range = mentionRange();
    if (!range) {
      return;
    }

    const nextDraft = `${props.draft.slice(0, range.start)}@${username} ${props.draft.slice(range.end)}`;
    const nextCaret = range.start + username.length + 2;
    props.onDraftInput(nextDraft);
    closeMentionPicker();
    queueMicrotask(() => {
      if (draftInputRef) {
        draftInputRef.focus();
        draftInputRef.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function applyEmojiShortcode(emoji: Emoji) {
    const range = emojiRange();
    if (!range) {
      return;
    }

    const nextDraft = `${props.draft.slice(0, range.start)}:${emoji.shortcode}: ${props.draft.slice(range.end)}`;
    const nextCaret = range.start + emoji.shortcode.length + 3;
    props.onDraftInput(nextDraft);
    closeEmojiShortcodePicker();
    queueMicrotask(() => {
      if (draftInputRef) {
        draftInputRef.focus();
        draftInputRef.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  return (
    <>
      <Show when={props.pendingAttachments.length > 0}>
        <div class="message-upload-queue">
          <For each={props.pendingAttachments}>
            {(attachment) => (
              <div class="message-upload-item" data-status={attachment.status}>
                <div>
                  <p class="message-upload-name">{attachment.filename}</p>
                  <p class="message-upload-meta">
                    <Show when={attachment.status === "uploading"}>Uploading...</Show>
                    <Show when={attachment.status === "processing"}>Processing preview...</Show>
                    <Show when={attachment.status === "ready"}>Ready</Show>
                    <Show when={attachment.status === "failed"}>{attachment.error ?? "Failed"}</Show>
                  </p>
                </div>
                <button
                  type="button"
                  class="message-upload-remove"
                  onClick={() => props.onRemoveAttachment(attachment.client_id)}
                  disabled={attachment.status === "uploading"}
                >
                  Remove
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <form class="message-input" onSubmit={props.onSubmit}>
        <div class="message-input-actions">
          <button
            type="button"
            class="message-attach-button"
            onClick={() => fileInputRef?.click()}
            disabled={!props.activeChannelId || props.isSending || !!props.savingMessageId || !!props.deletingMessageId}
            aria-label="Add image"
            title="Add image"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5z" fill="none" stroke="currentColor" stroke-width="1.6" />
              <circle cx="8" cy="8" r="1.3" fill="currentColor" />
              <path d="M6.5 14 10 10.5l2.2 2.2 1.8-1.8L16 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            class="message-attach-input"
            onChange={props.onAttachmentInput}
            disabled={!props.activeChannelId || props.isSending || !!props.savingMessageId || !!props.deletingMessageId}
          />

          <button
            type="button"
            ref={gifButtonRef}
            class="message-gif-button"
            onClick={() => setShowGifPicker((v) => !v)}
            disabled={!props.activeChannelId || props.isSending || !!props.savingMessageId || !!props.deletingMessageId}
            aria-label="Add GIF"
            title="Add GIF"
          >
            <span class="gif-button-text">GIF</span>
          </button>
          <Show when={showGifPicker()}>
            <Suspense fallback={null}>
              <GifPicker
                anchorRef={gifButtonRef}
                onSelect={(gif) => {
                  props.onGifSelect?.(gif);
                  setShowGifPicker(false);
                }}
                onClose={() => setShowGifPicker(false)}
              />
            </Suspense>
          </Show>

          <button
            type="button"
            ref={emojiButtonRef}
            class="message-emoji-button"
            onClick={() => setShowEmojiPicker((v) => !v)}
            disabled={!props.activeChannelId || props.isSending || !!props.savingMessageId || !!props.deletingMessageId}
            aria-label="Add emoji"
            title="Add emoji"
          >
            <span class="message-emoji-icon" aria-hidden="true">😊</span>
          </button>
          <Show when={showEmojiPicker()}>
            <Suspense fallback={null}>
              <EmojiPicker
                anchorRef={emojiButtonRef}
                onSelect={(selection) => {
                  if (selection.type === "unicode") {
                    insertEmoji(selection.emoji);
                  } else {
                    insertEmoji(`:${selection.emoji.shortcode}:`);
                  }
                  setShowEmojiPicker(false);
                }}
                onClose={() => setShowEmojiPicker(false)}
              />
            </Suspense>
          </Show>
        </div>
        <input
          type="text"
          placeholder={props.activeChannelId ? "Send a message or share an image..." : "Select a channel to start messaging"}
          value={props.draft}
          ref={draftInputRef}
          onInput={(event) => {
            props.onDraftInput(event.currentTarget.value);
            refreshMentionPicker(event.currentTarget.value, event.currentTarget.selectionStart);
            refreshEmojiShortcodePicker(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onClick={(event) => {
            refreshMentionPicker(event.currentTarget.value, event.currentTarget.selectionStart);
            refreshEmojiShortcodePicker(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onKeyUp={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
              return;
            }
            refreshMentionPicker(event.currentTarget.value, event.currentTarget.selectionStart);
            refreshEmojiShortcodePicker(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onKeyDown={(event) => {
            const mentionItems = mentionSuggestions();
            const emojiItems = emojiSuggestions();
            const hasMentionSuggestions = mentionItems.length > 0 && mentionRange() !== null;
            const hasEmojiSuggestions = emojiItems.length > 0 && emojiRange() !== null;

            if (!hasMentionSuggestions && !hasEmojiSuggestions) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (hasMentionSuggestions) {
                setSelectedMentionIndex((current) => (current + 1) % mentionItems.length);
              } else {
                setSelectedEmojiIndex((current) => (current + 1) % emojiItems.length);
              }
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (hasMentionSuggestions) {
                setSelectedMentionIndex((current) => (current - 1 + mentionItems.length) % mentionItems.length);
              } else {
                setSelectedEmojiIndex((current) => (current - 1 + emojiItems.length) % emojiItems.length);
              }
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              closeMentionPicker();
              closeEmojiShortcodePicker();
              return;
            }

            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              if (hasMentionSuggestions) {
                const nextIndex = selectedMentionIndex() % mentionItems.length;
                applyMention(mentionItems[nextIndex] ?? mentionItems[0]);
              } else {
                const nextIndex = selectedEmojiIndex() % emojiItems.length;
                const selectedEmoji = emojiItems[nextIndex] ?? emojiItems[0];
                if (selectedEmoji) {
                  applyEmojiShortcode(selectedEmoji);
                }
              }
            }
          }}
          onPaste={(event) => props.onDraftPaste(event)}
          onBlur={() => {
            setTimeout(() => {
              closeMentionPicker();
              closeEmojiShortcodePicker();
            }, 100);
          }}
          disabled={!props.activeChannelId || !!props.savingMessageId || !!props.deletingMessageId}
        />
        <Show when={mentionSuggestions().length > 0 && mentionRange() !== null}>
          <div class="mention-picker" role="listbox" aria-label="Mention suggestions">
            <For each={mentionSuggestions()}>
              {(entry, index) => (
                <button
                  type="button"
                  class={`mention-picker-item${index() === selectedMentionIndex() ? " is-selected" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(entry);
                  }}
                >
                  @{entry}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={emojiSuggestions().length > 0 && emojiRange() !== null}>
          <div class="mention-picker" role="listbox" aria-label="Emoji shortcode suggestions">
            <For each={emojiSuggestions()}>
              {(entry, index) => (
                <button
                  type="button"
                  class={`mention-picker-item${index() === selectedEmojiIndex() ? " is-selected" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyEmojiShortcode(entry);
                  }}
                >
                  :{entry.shortcode}: {entry.name}
                </button>
              )}
            </For>
          </div>
        </Show>

        <button
          type="submit"
          disabled={
            !props.activeChannelId
            || props.isSending
            || !!props.savingMessageId
            || !!props.deletingMessageId
            || props.hasBlockingAttachment
            || props.hasFailedAttachment
          }
        >
          Send
        </button>
      </form>
    </>
  );
}

