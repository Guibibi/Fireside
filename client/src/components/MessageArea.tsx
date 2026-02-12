import { For, Show, createEffect, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { get } from "../api/http";
import { connect, onMessage, send } from "../api/ws";
import { username } from "../stores/auth";
import { activeChannelId } from "../stores/chat";

interface ChannelMessage {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
}

async function fetchMessages(channelId: string | null) {
  if (!channelId) {
    return [] as ChannelMessage[];
  }

  return get<ChannelMessage[]>(`/channels/${channelId}/messages`);
}

export default function MessageArea() {
  const [draft, setDraft] = createSignal("");
  const [wsError, setWsError] = createSignal("");
  const [messages, setMessages] = createSignal<ChannelMessage[]>([]);
  const [typingUsernames, setTypingUsernames] = createSignal<string[]>([]);
  let listRef: HTMLDivElement | undefined;
  let typingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTypingChannelId: string | null = null;
  const typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const [history] = createResource(activeChannelId, fetchMessages);

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

  function stopTypingBroadcast() {
    if (typingDebounceTimer) {
      clearTimeout(typingDebounceTimer);
      typingDebounceTimer = null;
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

    if (typingDebounceTimer) {
      clearTimeout(typingDebounceTimer);
    }

    typingDebounceTimer = setTimeout(() => {
      stopTypingBroadcast();
    }, 1200);
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
            },
          ];
        });

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
    queueMicrotask(() => {
      if (listRef) {
        listRef.scrollTop = listRef.scrollHeight;
      }
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

    send({ type: "send_message", channel_id: channelId, content });
    stopTypingBroadcast();
    setDraft("");
  }

  return (
    <div class="message-area">
      <div class="messages" ref={listRef}>
        <Show when={!history.loading} fallback={<p class="placeholder">Loading messages...</p>}>
          <Show
            when={!history.error}
            fallback={<p class="error">{history.error instanceof Error ? history.error.message : "Failed to load messages"}</p>}
          >
            <Show
              when={messages().length > 0}
              fallback={<p class="placeholder">No messages yet</p>}
            >
              <ul class="message-items">
                <For each={messages()}>
                  {(message) => (
                    <li class="message-item">
                      <div class="message-meta">
                        <span class="message-author">{message.author_username}</span>
                        <time class="message-time">
                          {new Date(message.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p class="message-content">{message.content}</p>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </div>
      <form class="message-input" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder={activeChannelId() ? "Send a message..." : "Select a channel to start messaging"}
          value={draft()}
          onInput={(e) => handleDraftInput(e.currentTarget.value)}
          disabled={!activeChannelId()}
        />
        <button type="submit">Send</button>
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
