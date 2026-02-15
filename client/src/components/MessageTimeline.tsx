import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Channel } from "../stores/chat";
import { username } from "../stores/auth";
import {
  handleLongPressEnd,
  handleLongPressStart,
  openContextMenu,
  setContextMenuTarget,
} from "../stores/contextMenu";
import AsyncContent from "./AsyncContent";
import MessageRichContent from "./MessageRichContent";
import UserAvatar from "./UserAvatar";
import type { ChannelMessage, MessageDayGroup } from "./messageTypes";

interface MessageTimelineProps {
  activeChannel: Channel | null | undefined;
  loading: boolean;
  error: unknown;
  groupedMessages: MessageDayGroup[];
  stickyDateLabel: string;
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  editingMessageId: string | null;
  editDraft: string;
  savingMessageId: string | null;
  deletingMessageId: string | null;
  onScroll: (event: Event) => void;
  onListRef: (element: HTMLDivElement) => void;
  onItemsRef: (element: HTMLUListElement) => void;
  onDaySeparatorRef: (key: string, element: HTMLLIElement) => void;
  onBeginEdit: (message: ChannelMessage) => void;
  onRemoveMessage: (message: ChannelMessage) => void;
  onSaveEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditDraftInput: (value: string) => void;
  toAbsoluteMediaUrl: (path: string) => string;
}

interface LazyAttachmentImageProps {
  src: string;
  alt: string;
}

function LazyAttachmentImage(props: LazyAttachmentImageProps) {
  const [isVisible, setIsVisible] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let observer: IntersectionObserver | null = null;

  onMount(() => {
    if (!containerRef) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer?.disconnect();
          observer = null;
          break;
        }
      }
    }, {
      rootMargin: "280px 0px",
      threshold: 0.01,
    });

    observer.observe(containerRef);
  });

  onCleanup(() => {
    observer?.disconnect();
    observer = null;
  });

  return (
    <div class="message-attachment-image-slot" ref={(element) => {
      containerRef = element;
    }}>
      <Show when={isVisible()} fallback={<div class="message-attachment-image-placeholder" aria-hidden="true" />}>
        <img src={props.src} alt={props.alt} loading="lazy" decoding="async" />
      </Show>
    </div>
  );
}

export default function MessageTimeline(props: MessageTimelineProps) {
  return (
    <>
      <header class="message-area-header">
        <Show when={props.activeChannel} fallback={<p class="message-area-title">Select a channel</p>}>
          <>
            <p class="message-area-title">
              <span class="message-area-prefix">{props.activeChannel?.kind === "voice" ? "~" : "#"}</span>
              <span>{props.activeChannel?.name}</span>
            </p>
            <Show when={props.activeChannel?.description?.trim()}>
              <p class="message-area-description">{props.activeChannel?.description}</p>
            </Show>
          </>
        </Show>
      </header>
      <div class="messages" ref={props.onListRef} onScroll={props.onScroll}>
        <Show when={props.groupedMessages.length > 0 && (props.hasOlderMessages || props.loadingOlderMessages)}>
          <div class="messages-history-status">
            {props.loadingOlderMessages ? "Loading older messages..." : "Scroll up to load older messages"}
          </div>
        </Show>
        <Show when={props.stickyDateLabel}>
          <div class="messages-sticky-date">{props.stickyDateLabel}</div>
        </Show>
        <AsyncContent
          loading={props.loading}
          loadingText="Loading messages..."
          error={props.error}
          errorText="Failed to load messages"
          empty={props.groupedMessages.length === 0}
          emptyText="No messages yet"
        >
          <ul class="message-items" ref={props.onItemsRef}>
            <For each={props.groupedMessages}>
              {(group) => (
                <>
                  <li class="message-day-separator" ref={(element) => props.onDaySeparatorRef(group.key, element)}>
                    <span>{group.label}</span>
                  </li>
                  <For each={group.messages}>
                    {(message) => (
                      <li
                        class="message-item"
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openContextMenu(event.clientX, event.clientY, "message", message.id, message);
                        }}
                        onFocus={() => setContextMenuTarget("message", message.id, message)}
                        onTouchStart={(event) => {
                          const touch = event.touches[0];
                          handleLongPressStart(touch.clientX, touch.clientY, "message", message.id, message);
                        }}
                        onTouchEnd={handleLongPressEnd}
                      >
                        <UserAvatar username={message.author_username} class="message-avatar" size={36} />
                        <div class="message-meta">
                          <span class="message-author">{message.author_username}</span>
                          <time class="message-time">
                            {new Date(message.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          <Show when={message.edited_at}>
                            <span class="message-edited">(edited)</span>
                          </Show>
                          <Show when={message.author_username === username()}>
                            <div class="message-actions">
                              <button
                                type="button"
                                class="message-action"
                                onClick={() => props.onBeginEdit(message)}
                                disabled={!!props.savingMessageId || !!props.deletingMessageId}
                              >
                                edit
                              </button>
                              <button
                                type="button"
                                class="message-action message-action-danger"
                                onClick={() => props.onRemoveMessage(message)}
                                disabled={!!props.savingMessageId || !!props.deletingMessageId}
                              >
                                delete
                              </button>
                            </div>
                          </Show>
                        </div>
                        <Show
                          when={props.editingMessageId === message.id}
                          fallback={(
                            <>
                              <Show when={message.content.trim().length > 0}>
                                <MessageRichContent content={message.content} />
                              </Show>
                              <Show when={message.attachments.length > 0}>
                                <div class="message-attachments">
                                  <For each={message.attachments}>
                                    {(attachment) => (
                                      <figure class="message-attachment" data-status={attachment.status}>
                                        <Show
                                          when={attachment.status === "ready" && (attachment.thumbnail_url || attachment.display_url)}
                                          fallback={<div class="message-attachment-placeholder">Image processing...</div>}
                                        >
                                          <div class="message-attachment-media">
                                            <LazyAttachmentImage
                                              src={props.toAbsoluteMediaUrl(
                                                attachment.thumbnail_url ?? attachment.display_url ?? attachment.original_url,
                                              )}
                                              alt="Shared attachment"
                                            />
                                            <a
                                              class="message-attachment-download-overlay"
                                              href={props.toAbsoluteMediaUrl(attachment.original_url)}
                                              download="attachment"
                                              aria-label="Download attachment"
                                              title="Download attachment"
                                            >
                                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
                                              </svg>
                                            </a>
                                          </div>
                                        </Show>
                                      </figure>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </>
                          )}
                        >
                          <form
                            class="message-edit"
                            onSubmit={(event) => {
                              event.preventDefault();
                              props.onSaveEdit(message.id);
                            }}
                          >
                            <input
                              type="text"
                              value={props.editDraft}
                              onInput={(event) => props.onEditDraftInput(event.currentTarget.value)}
                              maxlength={4000}
                              disabled={props.savingMessageId === message.id || !!props.deletingMessageId}
                            />
                            <button type="submit" disabled={props.savingMessageId === message.id || !!props.deletingMessageId}>
                              save
                            </button>
                            <button
                              type="button"
                              onClick={props.onCancelEdit}
                              disabled={props.savingMessageId === message.id || !!props.deletingMessageId}
                            >
                              cancel
                            </button>
                          </form>
                        </Show>
                      </li>
                    )}
                  </For>
                </>
              )}
            </For>
          </ul>
        </AsyncContent>
      </div>
    </>
  );
}
