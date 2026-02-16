import { For, Show } from "solid-js";
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
  onSubmit: (event: Event) => void;
  onDraftInput: (value: string) => void;
  onAttachmentInput: (event: Event) => void;
  onDraftPaste: (event: ClipboardEvent) => void;
  onRemoveAttachment: (clientId: string) => void;
}

export default function MessageComposer(props: MessageComposerProps) {
  let fileInputRef: HTMLInputElement | undefined;

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
          onInput={(event) => props.onDraftInput(event.currentTarget.value)}
          onPaste={(event) => props.onDraftPaste(event)}
          disabled={!props.activeChannelId || !!props.savingMessageId || !!props.deletingMessageId}
        />
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
