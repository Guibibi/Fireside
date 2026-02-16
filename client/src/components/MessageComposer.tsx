import { For, Show, createMemo, createSignal } from "solid-js";
import type { PendingAttachment } from "./messageTypes";

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
}

export default function MessageComposer(props: MessageComposerProps) {
  let fileInputRef: HTMLInputElement | undefined;
  let draftInputRef: HTMLInputElement | undefined;

  const [mentionRange, setMentionRange] = createSignal<{ start: number; end: number } | null>(null);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [selectedMentionIndex, setSelectedMentionIndex] = createSignal(0);

  function closeMentionPicker() {
    setMentionRange(null);
    setMentionQuery("");
    setSelectedMentionIndex(0);
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
        <input
          type="text"
          placeholder={props.activeChannelId ? "Send a message or share an image..." : "Select a channel to start messaging"}
          value={props.draft}
          ref={draftInputRef}
          onInput={(event) => {
            props.onDraftInput(event.currentTarget.value);
            refreshMentionPicker(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onClick={(event) => refreshMentionPicker(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyUp={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
              return;
            }
            refreshMentionPicker(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onKeyDown={(event) => {
            const suggestions = mentionSuggestions();
            if (suggestions.length === 0 || !mentionRange()) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedMentionIndex((current) => (current + 1) % suggestions.length);
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedMentionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              closeMentionPicker();
              return;
            }

            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const nextIndex = selectedMentionIndex() % suggestions.length;
              applyMention(suggestions[nextIndex] ?? suggestions[0]);
            }
          }}
          onPaste={(event) => props.onDraftPaste(event)}
          onBlur={() => {
            setTimeout(() => {
              closeMentionPicker();
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
