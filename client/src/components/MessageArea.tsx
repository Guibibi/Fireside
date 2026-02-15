import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { del, get, patch } from "../api/http";
import { connect, onMessage, send } from "../api/ws";
import { errorMessage } from "../utils/error";
import AsyncContent from "./AsyncContent";
import { username } from "../stores/auth";
import { activeChannelId, type Channel } from "../stores/chat";
import { openContextMenu, registerContextMenuHandlers, handleLongPressStart, handleLongPressEnd, setContextMenuTarget } from "../stores/contextMenu";
import VideoStage from "./VideoStage";

interface ChannelMessage {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
}

interface MessageDayGroup {
  key: string;
  label: string;
  messages: ChannelMessage[];
}

function getMessageDayKey(createdAt: string) {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMessageDayLabel(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === -1) {
    return "Yesterday";
  }

  return date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

async function fetchMessages(channelId: string | null) {
  if (!channelId) {
    return [] as ChannelMessage[];
  }

  return get<ChannelMessage[]>(`/channels/${channelId}/messages`);
}

async function fetchActiveChannel(channelId: string | null) {
  if (!channelId) {
    return null;
  }

  return get<Channel>(`/channels/${channelId}`);
}

export default function MessageArea() {
  const [draft, setDraft] = createSignal("");
  const [wsError, setWsError] = createSignal("");
  const [messages, setMessages] = createSignal<ChannelMessage[]>([]);
  const [typingUsernames, setTypingUsernames] = createSignal<string[]>([]);
  const [editingMessageId, setEditingMessageId] = createSignal<string | null>(null);
  const [editDraft, setEditDraft] = createSignal("");
  const [savingMessageId, setSavingMessageId] = createSignal<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = createSignal<string | null>(null);
  const [isSending, setIsSending] = createSignal(false);
  const [stickyDateLabel, setStickyDateLabel] = createSignal("");
  let listRef: HTMLDivElement | undefined;
  let activeTypingChannelId: string | null = null;
  let typingHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let previousMessageCount = 0;
  const typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const daySeparatorRefs = new Map<string, HTMLLIElement>();

  const [history] = createResource(activeChannelId, fetchMessages);
  const [activeChannel] = createResource(activeChannelId, fetchActiveChannel);
  const groupedMessages = createMemo<MessageDayGroup[]>(() => {
    const groups: MessageDayGroup[] = [];

    for (const message of messages()) {
      const dayKey = getMessageDayKey(message.created_at);
      const previousGroup = groups[groups.length - 1];

      if (!previousGroup || previousGroup.key !== dayKey) {
        groups.push({
          key: dayKey,
          label: formatMessageDayLabel(dayKey),
          messages: [message],
        });
        continue;
      }

      previousGroup.messages.push(message);
    }

    return groups;
  });

  function updateStickyDate() {
    const groups = groupedMessages();
    if (!listRef || groups.length === 0) {
      setStickyDateLabel("");
      return;
    }

    const scrollTop = listRef.scrollTop;
    let nextLabel = groups[0].label;

    for (const group of groups) {
      const separator = daySeparatorRefs.get(group.key);
      if (!separator) {
        continue;
      }

      if (separator.offsetTop <= scrollTop + 8) {
        nextLabel = group.label;
      } else {
        break;
      }
    }

    setStickyDateLabel(nextLabel);
  }

  function clearTypingExpiryTimer(typingUsername: string) {
    const timer = typingExpiryTimers.get(typingUsername);
    if (timer) {
      clearTimeout(timer);
      typingExpiryTimers.delete(typingUsername);
    }
  }

  function removeTypingUser(typingUsername: string) {
    clearTypingExpiryTimer(typingUsername);
    setTypingUsernames((current) => current.filter((entry) => entry !== typingUsername));
  }

  function touchTypingUser(typingUsername: string) {
    setTypingUsernames((current) => (
      current.includes(typingUsername) ? current : [...current, typingUsername]
    ));

    clearTypingExpiryTimer(typingUsername);
    typingExpiryTimers.set(typingUsername, setTimeout(() => {
      removeTypingUser(typingUsername);
    }, 3000));
  }

  function clearTypingUsers() {
    typingExpiryTimers.forEach((timer) => clearTimeout(timer));
    typingExpiryTimers.clear();
    setTypingUsernames([]);
  }

  function startTypingHeartbeat() {
    if (typingHeartbeatTimer) {
      return;
    }

    typingHeartbeatTimer = setInterval(() => {
      const channelId = activeChannelId();
      const hasDraft = draft().trim().length > 0;

      if (!channelId || !hasDraft || activeTypingChannelId !== channelId) {
        return;
      }

      send({ type: "typing_start", channel_id: channelId });
    }, 2000);
  }

  function stopTypingBroadcast() {
    if (typingHeartbeatTimer) {
      clearInterval(typingHeartbeatTimer);
      typingHeartbeatTimer = null;
    }

    if (activeTypingChannelId) {
      send({ type: "typing_stop", channel_id: activeTypingChannelId });
      activeTypingChannelId = null;
    }
  }

  function handleDraftInput(value: string) {
    setDraft(value);

    const channelId = activeChannelId();
    const hasContent = value.trim().length > 0;
    if (!channelId || !hasContent) {
      stopTypingBroadcast();
      return;
    }

    if (activeTypingChannelId !== channelId) {
      stopTypingBroadcast();
      send({ type: "typing_start", channel_id: channelId });
      activeTypingChannelId = channelId;
    }

    startTypingHeartbeat();
  }

  function beginEdit(message: ChannelMessage) {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
    setWsError("");
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setEditDraft("");
    setSavingMessageId(null);
  }

  async function saveEdit(messageId: string) {
    const content = editDraft().trim();
    if (!content || savingMessageId() || deletingMessageId()) {
      return;
    }

    setWsError("");
    setSavingMessageId(messageId);
    try {
      const updated = await patch<ChannelMessage>(`/messages/${messageId}`, { content });
      setMessages((current) => current.map((message) => (
        message.id === updated.id
          ? { ...message, content: updated.content, edited_at: updated.edited_at }
          : message
      )));
      cancelEdit();
    } catch (error) {
      setWsError(errorMessage(error, "Failed to edit message"));
    } finally {
      setSavingMessageId(null);
    }
  }

  async function removeMessage(message: ChannelMessage) {
    if (savingMessageId() || deletingMessageId()) {
      return;
    }

    const confirmed = window.confirm("Delete this message?");
    if (!confirmed) {
      return;
    }

    setWsError("");
    setDeletingMessageId(message.id);
    try {
      await del<{ deleted: true }>(`/messages/${message.id}`);
      setMessages((current) => current.filter((entry) => entry.id !== message.id));
      if (editingMessageId() === message.id) {
        cancelEdit();
      }
    } catch (error) {
      setWsError(errorMessage(error, "Failed to delete message"));
    } finally {
      setDeletingMessageId(null);
    }
  }

  function typingText() {
    const names = typingUsernames();
    if (names.length === 0) {
      return "";
    }

    if (names.length === 1) {
      return `${names[0]} is typing...`;
    }

    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing...`;
    }

    return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing...`;
  }

  onMount(() => {
    connect();

    registerContextMenuHandlers({
      message: {
        onEdit: (msgData) => {
          const msg = messages().find((m) => m.id === msgData.id);
          if (msg) {
            beginEdit(msg);
          }
        },
        onDelete: (msgData) => {
          const msg = messages().find((m) => m.id === msgData.id);
          if (msg) {
            void removeMessage(msg);
          }
        },
      },
    });

    const unsubscribe = onMessage((msg) => {
      if (msg.type === "error") {
        setWsError(msg.message);
        return;
      }

      if (msg.type === "new_message") {
        removeTypingUser(msg.author_username);

        if (msg.channel_id !== activeChannelId()) {
          return;
        }

        setMessages((current) => {
          if (current.some((entry) => entry.id === msg.id)) {
            return current;
          }

          return [
            ...current,
            {
              id: msg.id,
              channel_id: msg.channel_id,
              author_id: msg.author_id,
              author_username: msg.author_username,
              content: msg.content,
              created_at: msg.created_at,
              edited_at: msg.edited_at ?? null,
            },
          ];
        });

        return;
      }

      if (msg.type === "message_edited") {
        if (msg.channel_id !== activeChannelId()) {
          return;
        }

        setMessages((current) => current.map((message) => (
          message.id === msg.id
            ? { ...message, content: msg.content, edited_at: msg.edited_at }
            : message
        )));
        return;
      }

      if (msg.type === "message_deleted") {
        if (msg.channel_id !== activeChannelId()) {
          return;
        }

        setMessages((current) => current.filter((message) => message.id !== msg.id));
        if (editingMessageId() === msg.id) {
          cancelEdit();
        }
        return;
      }

      if (msg.type === "typing_start") {
        if (msg.channel_id !== activeChannelId() || msg.username === username()) {
          return;
        }

        touchTypingUser(msg.username);
        return;
      }

      if (msg.type === "typing_stop") {
        if (msg.channel_id !== activeChannelId()) {
          return;
        }

        removeTypingUser(msg.username);
      }
    });

    onCleanup(() => {
      stopTypingBroadcast();
      clearTypingUsers();
      unsubscribe();
    });
  });

  createEffect(() => {
    const channelId = activeChannelId();

    if (activeTypingChannelId && activeTypingChannelId !== channelId) {
      stopTypingBroadcast();
    }

    clearTypingUsers();

    setMessages([]);
    cancelEdit();
    setDeletingMessageId(null);
    setWsError("");
    previousMessageCount = 0;
    daySeparatorRefs.clear();
    setStickyDateLabel("");

    if (!channelId) {
      return;
    }

    send({ type: "subscribe_channel", channel_id: channelId });
  });

  createEffect(() => {
    const loadedHistory = history();
    if (!loadedHistory) {
      return;
    }

    const historyAscending = [...loadedHistory].reverse();
    setMessages((current) => {
      const mergedById = new Map<string, ChannelMessage>();

      for (const message of historyAscending) {
        mergedById.set(message.id, message);
      }

      for (const message of current) {
        mergedById.set(message.id, message);
      }

      return Array.from(mergedById.values()).sort((a, b) => (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ));
    });
  });

  createEffect(() => {
    messages();
    const count = messages().length;
    if (count > previousMessageCount) {
      queueMicrotask(() => {
        if (listRef) {
          listRef.scrollTop = listRef.scrollHeight;
        }
      });
    }
    previousMessageCount = count;

    queueMicrotask(() => {
      updateStickyDate();
    });
  });

  createEffect(() => {
    groupedMessages();
    queueMicrotask(() => {
      updateStickyDate();
    });
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    setWsError("");

    const channelId = activeChannelId();
    const content = draft().trim();
    if (!channelId || !content) {
      return;
    }

    setIsSending(true);
    send({ type: "send_message", channel_id: channelId, content });
    stopTypingBroadcast();
    setDraft("");
    queueMicrotask(() => setIsSending(false));
  }

  return (
    <div class="message-area">
      <header class="message-area-header">
        <Show when={activeChannel()} fallback={<p class="message-area-title">Select a channel</p>}>
          <>
            <p class="message-area-title">
              <span class="message-area-prefix">{activeChannel()?.kind === "voice" ? "~" : "#"}</span>
              <span>{activeChannel()?.name}</span>
            </p>
            <Show when={activeChannel()?.description?.trim()}>
              <p class="message-area-description">{activeChannel()?.description}</p>
            </Show>
          </>
        </Show>
      </header>
      <div class="messages" ref={listRef} onScroll={updateStickyDate}>
        <Show when={stickyDateLabel()}>
          <div class="messages-sticky-date">{stickyDateLabel()}</div>
        </Show>
        <AsyncContent
          loading={history.loading}
          loadingText="Loading messages..."
          error={history.error}
          errorText="Failed to load messages"
          empty={messages().length === 0}
          emptyText="No messages yet"
        >
          <ul class="message-items">
            <For each={groupedMessages()}>
              {(group) => (
                <>
                  <li
                    class="message-day-separator"
                    ref={(element) => {
                      daySeparatorRefs.set(group.key, element);
                    }}
                  >
                    <span>{group.label}</span>
                  </li>
                  <For each={group.messages}>
                    {(message) => (
                      <li
                        class="message-item"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openContextMenu(e.clientX, e.clientY, "message", message.id, message);
                        }}
                        onFocus={() => setContextMenuTarget("message", message.id, message)}
                        onTouchStart={(e) => {
                          const touch = e.touches[0];
                          handleLongPressStart(touch.clientX, touch.clientY, "message", message.id, message);
                        }}
                        onTouchEnd={handleLongPressEnd}
                      >
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
                                onClick={() => beginEdit(message)}
                                disabled={!!savingMessageId() || !!deletingMessageId()}
                              >
                                edit
                              </button>
                              <button
                                type="button"
                                class="message-action message-action-danger"
                                onClick={() => void removeMessage(message)}
                                disabled={!!savingMessageId() || !!deletingMessageId()}
                              >
                                delete
                              </button>
                            </div>
                          </Show>
                        </div>
                        <Show
                          when={editingMessageId() === message.id}
                          fallback={<p class="message-content">{message.content}</p>}
                        >
                          <form class="message-edit" onSubmit={(e) => {
                            e.preventDefault();
                            void saveEdit(message.id);
                          }}>
                            <input
                              type="text"
                              value={editDraft()}
                              onInput={(e) => setEditDraft(e.currentTarget.value)}
                              maxlength={4000}
                              disabled={savingMessageId() === message.id || !!deletingMessageId()}
                            />
                            <button
                              type="submit"
                              disabled={savingMessageId() === message.id || !!deletingMessageId()}
                            >
                              save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={savingMessageId() === message.id || !!deletingMessageId()}
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
      <VideoStage />
      <form class="message-input" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder={activeChannelId() ? "Send a message..." : "Select a channel to start messaging"}
          value={draft()}
          onInput={(e) => handleDraftInput(e.currentTarget.value)}
          disabled={!activeChannelId() || !!savingMessageId() || !!deletingMessageId()}
        />
        <button type="submit" disabled={!activeChannelId() || isSending() || !!savingMessageId() || !!deletingMessageId()}>
          Send
        </button>
      </form>
      <Show when={typingUsernames().length > 0}>
        <p class="typing-indicator">{typingText()}</p>
      </Show>
      <Show when={wsError()}>
        <p class="error message-error">{wsError()}</p>
      </Show>
    </div>
  );
}
