import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import type { MessageReactionDetail } from "../api/reactions";
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
import ReactionPicker from "./ReactionPicker";
import UserAvatar from "./UserAvatar";
import type { ChannelMessage, MessageDayGroup, MessageReaction } from "./messageTypes";
import { isMentioningUsername } from "../utils/mentions";
import { ZoomIcon, CloseIcon, DownloadIcon, ExternalLinkIcon, MenuIcon } from "./icons";
import { toggleMobileNav } from "../stores/chat";
import { displayNameFor } from "../stores/userProfiles";
import { loadEmojis, useEmojiStore } from "../stores/emojis";
import { errorMessage } from "../utils/error";

interface MessageTimelineProps {
  activeChannel: Channel | null | undefined;
  hasActiveTarget: boolean;
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
  onAddReaction: (messageId: string, reaction: { emoji_id?: string; unicode_emoji?: string }) => void;
  onRemoveReaction: (messageId: string, reaction: MessageReaction) => void;
  onLoadReactionDetails: (messageId: string) => Promise<MessageReactionDetail[]>;
  toAbsoluteMediaUrl: (path: string) => string;
}

interface LazyAttachmentImageProps {
  src: string;
  alt: string;
}

interface AttachmentPreview {
  displayUrl: string;
  originalUrl: string;
}

interface ReactionPopoverState {
  messageId: string;
  hoveredReactionKey: string;
  details: MessageReactionDetail[];
  loading: boolean;
  error: string | null;
}

function reactionKey(reaction: { emoji_id: string | null; unicode_emoji: string | null }): string {
  return `${reaction.emoji_id ?? ""}:${reaction.unicode_emoji ?? ""}`;
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
  const emojiStore = useEmojiStore();
  const customEmojiById = createMemo(() => {
    const lookup = new Map<string, { url: string }>();
    for (const emoji of emojiStore.emojis) {
      lookup.set(emoji.id, { url: emoji.url });
    }
    return lookup;
  });
  const [attachmentPreview, setAttachmentPreview] = createSignal<AttachmentPreview | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = createSignal<string | null>(null);
  const [reactionPickerAnchor, setReactionPickerAnchor] = createSignal<HTMLElement | null>(null);
  const [reactionPopover, setReactionPopover] = createSignal<ReactionPopoverState | null>(null);
  const [reactionPopoverAnchor, setReactionPopoverAnchor] = createSignal<HTMLElement | null>(null);
  const [reactionPopoverAnchorRect, setReactionPopoverAnchorRect] = createSignal<DOMRect | null>(null);
  const reactionDetailsCache = new Map<string, MessageReactionDetail[]>();
  const reactionDetailsInFlight = new Map<string, Promise<MessageReactionDetail[]>>();
  let reactionPopoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReactionPopoverCloseTimer() {
    if (!reactionPopoverCloseTimer) {
      return;
    }

    clearTimeout(reactionPopoverCloseTimer);
    reactionPopoverCloseTimer = null;
  }

  function closeReactionPopover() {
    clearReactionPopoverCloseTimer();
    setReactionPopover(null);
    setReactionPopoverAnchor(null);
    setReactionPopoverAnchorRect(null);
  }

  function scheduleReactionPopoverClose() {
    clearReactionPopoverCloseTimer();
    reactionPopoverCloseTimer = setTimeout(() => {
      closeReactionPopover();
    }, 140);
  }

  function updateReactionPopoverAnchorRect() {
    const anchor = reactionPopoverAnchor();
    if (!anchor) {
      setReactionPopoverAnchorRect(null);
      return;
    }

    setReactionPopoverAnchorRect(anchor.getBoundingClientRect());
  }

  function loadReactionDetails(messageId: string): Promise<MessageReactionDetail[]> {
    const cached = reactionDetailsCache.get(messageId);
    if (cached) {
      return Promise.resolve(cached);
    }

    const pending = reactionDetailsInFlight.get(messageId);
    if (pending) {
      return pending;
    }

    const request = props.onLoadReactionDetails(messageId)
      .then((details) => {
        reactionDetailsCache.set(messageId, details);
        reactionDetailsInFlight.delete(messageId);
        return details;
      })
      .catch((error: unknown) => {
        reactionDetailsInFlight.delete(messageId);
        throw error;
      });

    reactionDetailsInFlight.set(messageId, request);
    return request;
  }

  async function openReactionPopover(
    messageId: string,
    reaction: { emoji_id: string | null; unicode_emoji: string | null },
    anchor: HTMLElement,
  ) {
    clearReactionPopoverCloseTimer();
    const hoveredReactionKey = reactionKey(reaction);
    setReactionPopoverAnchor(anchor);
    updateReactionPopoverAnchorRect();

    const cached = reactionDetailsCache.get(messageId);
    setReactionPopover({
      messageId,
      hoveredReactionKey,
      details: cached ?? [],
      loading: !cached,
      error: null,
    });

    if (cached) {
      return;
    }

    try {
      const details = await loadReactionDetails(messageId);
      setReactionPopover((current) => {
        if (!current || current.messageId !== messageId) {
          return current;
        }

        return {
          ...current,
          details,
          loading: false,
          error: null,
        };
      });
    } catch (error: unknown) {
      setReactionPopover((current) => {
        if (!current || current.messageId !== messageId) {
          return current;
        }

        return {
          ...current,
          loading: false,
          error: errorMessage(error, "Failed to load reactions"),
        };
      });
    }
  }

  const orderedPopoverDetails = createMemo(() => {
    const state = reactionPopover();
    if (!state) {
      return [];
    }

    return [...state.details].sort((left, right) => {
      const leftMatch = reactionKey(left) === state.hoveredReactionKey;
      const rightMatch = reactionKey(right) === state.hoveredReactionKey;
      if (leftMatch === rightMatch) {
        return 0;
      }
      return leftMatch ? -1 : 1;
    });
  });

  const reactionPopoverStyle = createMemo(() => {
    const anchorRect = reactionPopoverAnchorRect();
    if (!anchorRect) {
      return { left: "-9999px", top: "-9999px" };
    }

    const popupWidth = 264;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      Math.max(8, anchorRect.left + (anchorRect.width / 2) - (popupWidth / 2)),
      Math.max(8, viewportWidth - popupWidth - 8),
    );

    const estimatedHeight = 160;
    const placeAbove = anchorRect.top > estimatedHeight + 16;
    const top = placeAbove
      ? Math.max(8, anchorRect.top - 10)
      : Math.min(viewportHeight - 8, anchorRect.bottom + 10);

    return {
      left: `${left}px`,
      top: `${top}px`,
      transform: placeAbove ? "translateY(-100%)" : "none",
    };
  });

  createEffect(() => {
    void loadEmojis();
  });

  createEffect(() => {
    const anchor = reactionPopoverAnchor();
    if (!anchor) {
      return;
    }

    const updatePosition = () => {
      if (!reactionPopoverAnchor()) {
        return;
      }
      updateReactionPopoverAnchorRect();
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    onCleanup(() => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    });
  });

  function messageClassName(content: string): string {
    const currentUsername = username();
    const mentioned = currentUsername
      ? isMentioningUsername(content, currentUsername)
      : false;
    return mentioned ? "message-item message-item-mentioned" : "message-item";
  }

  createEffect(() => {
    if (!attachmentPreview()) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAttachmentPreview(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  onCleanup(() => {
    clearReactionPopoverCloseTimer();
  });

  return (
    <>
      <header class="message-area-header">
        <button type="button" class="mobile-nav-toggle" onClick={toggleMobileNav} aria-label="Open menu">
          <MenuIcon />
        </button>
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
          emptyContent={
            <div class="messages-empty">
              <span class="messages-empty-glyph" aria-hidden="true">#</span>
              <Show
                when={props.hasActiveTarget}
                fallback={
                  <>
                    <p class="messages-empty-label">No channel selected</p>
                    <p class="messages-empty-hint">
                      Pick a channel from the sidebar to start chatting.
                    </p>
                  </>
                }
              >
                <Show
                  when={props.activeChannel}
                  fallback={
                    <>
                      <p class="messages-empty-label">No messages yet</p>
                      <p class="messages-empty-hint">Say hello — start the conversation.</p>
                    </>
                  }
                >
                  <p class="messages-empty-label">{props.activeChannel?.name}</p>
                  <p class="messages-empty-hint">
                    No messages yet — say something to get the conversation started.
                  </p>
                </Show>
              </Show>
            </div>
          }
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
                        class={messageClassName(message.content)}
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
                          <span class="message-author">{message.author_display_name || displayNameFor(message.author_username)}</span>
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
                                      <figure
                                        class={`message-attachment${attachment.mime_type === "image/gif" ? " message-attachment-gif" : ""}`}
                                        data-status={attachment.status}
                                      >
                                        <Show
                                          when={attachment.status === "ready" && (attachment.thumbnail_url || attachment.display_url)}
                                          fallback={<div class="message-attachment-placeholder">Image processing...</div>}
                                        >
                                          <div class="message-attachment-media">
                                            <button
                                              type="button"
                                              class="message-attachment-open"
                                              onClick={() => {
                                                setAttachmentPreview({
                                                  displayUrl: props.toAbsoluteMediaUrl(attachment.display_url ?? attachment.original_url),
                                                  originalUrl: props.toAbsoluteMediaUrl(attachment.original_url),
                                                });
                                              }}
                                              aria-label="Open image preview"
                                              title="Open image preview"
                                            >
                                              <LazyAttachmentImage
                                                src={props.toAbsoluteMediaUrl(
                                                  attachment.mime_type === "image/gif"
                                                    ? (attachment.display_url ?? attachment.original_url)
                                                    : (attachment.thumbnail_url ?? attachment.display_url ?? attachment.original_url),
                                                )}
                                                alt="Shared attachment"
                                              />
                                            </button>
                                            <button
                                              type="button"
                                              class="message-attachment-preview-overlay"
                                              onClick={() => {
                                                setAttachmentPreview({
                                                  displayUrl: props.toAbsoluteMediaUrl(attachment.display_url ?? attachment.original_url),
                                                  originalUrl: props.toAbsoluteMediaUrl(attachment.original_url),
                                                });
                                              }}
                                              aria-label="Open image preview"
                                              title="Open image preview"
                                            >
                                              <ZoomIcon />
                                            </button>
                                          </div>
                                        </Show>
                                      </figure>
                                    )}
                                  </For>
                                </div>
                              </Show>
                              <div class="message-reactions">
                                <For each={message.reactions}>
                                  {(reaction) => {
                                    const [emojiImageFailed, setEmojiImageFailed] = createSignal(false);
                                    const customEmojiUrl = createMemo(() => {
                                      if (!reaction.emoji_id) {
                                        return null;
                                      }
                                      return customEmojiById().get(reaction.emoji_id)?.url ?? null;
                                    });

                                    return (
                                      <button
                                        type="button"
                                        class={`message-reaction-chip${reaction.user_reacted ? " is-active" : ""}`}
                                        onMouseEnter={(event) => {
                                          void openReactionPopover(message.id, reaction, event.currentTarget);
                                        }}
                                        onFocus={(event) => {
                                          void openReactionPopover(message.id, reaction, event.currentTarget);
                                        }}
                                        onMouseLeave={scheduleReactionPopoverClose}
                                        onBlur={scheduleReactionPopoverClose}
                                        onClick={() => {
                                          if (reaction.user_reacted) {
                                            props.onRemoveReaction(message.id, reaction);
                                          } else {
                                            props.onAddReaction(message.id, {
                                              ...(reaction.emoji_id ? { emoji_id: reaction.emoji_id } : {}),
                                              ...(reaction.unicode_emoji ? { unicode_emoji: reaction.unicode_emoji } : {}),
                                            });
                                          }
                                        }}
                                        title={reaction.shortcode ? `:${reaction.shortcode}:` : (reaction.unicode_emoji ?? "Reaction")}
                                      >
                                        <Show
                                          when={reaction.unicode_emoji}
                                          fallback={(
                                            <Show
                                              when={customEmojiUrl() && !emojiImageFailed()}
                                              fallback={<span class="message-reaction-emoji">{`:${reaction.shortcode ?? "emoji"}:`}</span>}
                                            >
                                              <img
                                                class="message-reaction-emoji-image"
                                                src={customEmojiUrl() ?? ""}
                                                alt={`:${reaction.shortcode ?? "emoji"}:`}
                                                decoding="async"
                                                onError={() => setEmojiImageFailed(true)}
                                              />
                                            </Show>
                                          )}
                                        >
                                          <span class="message-reaction-emoji">{reaction.unicode_emoji}</span>
                                        </Show>
                                        <span class="message-reaction-count">{reaction.count}</span>
                                      </button>
                                    );
                                  }}
                                </For>
                                <button
                                  type="button"
                                  class={`message-reaction-add${reactionPickerMessageId() === message.id ? " is-visible" : ""}`}
                                  onClick={(event) => {
                                    const opening = reactionPickerMessageId() !== message.id;
                                    setReactionPickerMessageId((current) => current === message.id ? null : message.id);
                                    if (opening) {
                                      setReactionPickerAnchor(event.currentTarget);
                                    } else {
                                      setReactionPickerAnchor(null);
                                    }
                                  }}
                                  aria-label="Add reaction"
                                  title="Add reaction"
                                >
                                  +
                                </button>
                              </div>
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
          <Show when={reactionPickerMessageId() !== null}>
            <ReactionPicker
              anchorRef={reactionPickerAnchor() ?? undefined}
              onSelect={(selection) => {
                const messageId = reactionPickerMessageId();
                if (!messageId) {
                  return;
                }

                if (selection.type === "custom") {
                  props.onAddReaction(messageId, { emoji_id: selection.emoji.id });
                } else {
                  props.onAddReaction(messageId, { unicode_emoji: selection.emoji });
                }
                setReactionPickerMessageId(null);
                setReactionPickerAnchor(null);
              }}
              onClose={() => {
                setReactionPickerMessageId(null);
                setReactionPickerAnchor(null);
              }}
            />
          </Show>
          <Show when={reactionPopover()}>
            {(popover) => (
              <Portal>
                <div
                  class="message-reaction-popover"
                  style={reactionPopoverStyle()}
                  onMouseEnter={clearReactionPopoverCloseTimer}
                  onMouseLeave={scheduleReactionPopoverClose}
                  role="status"
                  aria-live="polite"
                >
                  <Show when={!popover().loading} fallback={<p class="message-reaction-popover-state">Loading reactions...</p>}>
                    <Show when={!popover().error} fallback={<p class="message-reaction-popover-state">{popover().error}</p>}>
                      <Show when={orderedPopoverDetails().length > 0} fallback={<p class="message-reaction-popover-state">No reactions yet.</p>}>
                        <ul class="message-reaction-popover-list">
                          <For each={orderedPopoverDetails()}>
                            {(entry) => {
                              const [emojiImageFailed, setEmojiImageFailed] = createSignal(false);
                              const customEmojiUrl = createMemo(() => {
                                if (!entry.emoji_id) {
                                  return null;
                                }
                                return customEmojiById().get(entry.emoji_id)?.url ?? null;
                              });

                              return (
                                <li class="message-reaction-popover-item">
                                  <span class="message-reaction-popover-emoji" aria-hidden="true">
                                    <Show
                                      when={entry.unicode_emoji}
                                      fallback={(
                                        <Show
                                          when={customEmojiUrl() && !emojiImageFailed()}
                                          fallback={<span class="message-reaction-emoji">{`:${entry.shortcode ?? "emoji"}:`}</span>}
                                        >
                                          <img
                                            class="message-reaction-emoji-image"
                                            src={customEmojiUrl() ?? ""}
                                            alt={`:${entry.shortcode ?? "emoji"}:`}
                                            decoding="async"
                                            onError={() => setEmojiImageFailed(true)}
                                          />
                                        </Show>
                                      )}
                                    >
                                      <span class="message-reaction-emoji">{entry.unicode_emoji}</span>
                                    </Show>
                                  </span>
                                  <span class="message-reaction-popover-users">
                                    {entry.users.map((user) => user.display_name || user.username).join(", ")}
                                  </span>
                                </li>
                              );
                            }}
                          </For>
                        </ul>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </Portal>
            )}
          </Show>
        </AsyncContent>
      </div>
      <Show when={attachmentPreview()}>
        <Portal>
          <div class="message-image-popup" role="presentation" onClick={() => setAttachmentPreview(null)}>
            <div
              class="message-image-popup-content"
              role="dialog"
              aria-modal="true"
              aria-label="Image preview"
            >
              <div class="message-image-popup-stage" onClick={(event) => event.stopPropagation()}>
                <img src={attachmentPreview()?.displayUrl ?? ""} alt="Expanded chat image" loading="eager" decoding="async" />
                <div class="message-image-modal-actions" role="group" aria-label="Image actions">
                  <button
                    type="button"
                    class="message-image-modal-action"
                    onClick={() => setAttachmentPreview(null)}
                    aria-label="Close preview"
                    title="Close"
                  >
                    <CloseIcon />
                  </button>
                  <a
                    class="message-image-modal-action"
                    href={attachmentPreview()?.originalUrl ?? "#"}
                    download="attachment"
                    aria-label="Download image"
                    title="Download"
                  >
                    <DownloadIcon />
                  </a>
                  <a
                    class="message-image-modal-action"
                    href={attachmentPreview()?.originalUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open full image in new tab"
                    title="Open full image"
                  >
                    <ExternalLinkIcon />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
