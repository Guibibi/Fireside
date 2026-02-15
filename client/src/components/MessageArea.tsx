import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { del, get, patch } from "../api/http";
import { connect, onMessage, send } from "../api/ws";
import { getApiBaseUrl, token, username } from "../stores/auth";
import { activeChannelId, type Channel } from "../stores/chat";
import { registerContextMenuHandlers } from "../stores/contextMenu";
import { setUserProfiles, upsertUserProfile } from "../stores/userProfiles";
import { errorMessage } from "../utils/error";
import MessageComposer from "./MessageComposer";
import MessageTimeline from "./MessageTimeline";
import VideoStage from "./VideoStage";
import { useTypingPresence } from "./useTypingPresence";
import {
  toAbsoluteMediaUrl,
  uploadError,
  uploadMediaFile,
  validateImageAttachment,
  waitForMediaDerivative,
} from "./messageAttachments";
import {
  type ChannelMessage,
  type MessageDayGroup,
  type PendingAttachment,
  type UsersResponse,
  formatMessageDayLabel,
  getMessageDayKey,
  typingText,
} from "./messageTypes";

interface EditedMessageResponse {
  id: string;
  content: string;
  edited_at?: string | null;
}

const MESSAGE_PAGE_SIZE = 20;

async function fetchMessagesPage(channelId: string, before?: string) {
  const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
  if (before) {
    params.set("before", before);
  }

  return get<ChannelMessage[]>(`/channels/${channelId}/messages?${params.toString()}`);
}

function setListScrollTopInstant(list: HTMLDivElement, top: number) {
  list.scrollTo({ top, behavior: "auto" });
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
  const [editingMessageId, setEditingMessageId] = createSignal<string | null>(null);
  const [editDraft, setEditDraft] = createSignal("");
  const [savingMessageId, setSavingMessageId] = createSignal<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = createSignal<string | null>(null);
  const [isSending, setIsSending] = createSignal(false);
  const [stickyDateLabel, setStickyDateLabel] = createSignal("");
  const [pendingAttachments, setPendingAttachments] = createSignal<PendingAttachment[]>([]);
  const [historyLoading, setHistoryLoading] = createSignal(false);
  const [historyError, setHistoryError] = createSignal<unknown>(null);
  const [loadingOlderMessages, setLoadingOlderMessages] = createSignal(false);
  const [hasOlderMessages, setHasOlderMessages] = createSignal(true);

  let listRef: HTMLDivElement | undefined;
  let messageItemsRef: HTMLUListElement | undefined;
  let previousMessageCount = 0;
  let latestHistoryRequest = 0;
  let isPrependingHistory = false;
  let hasAnchoredInitialBottom = false;
  let lastKnownScrollTop = 0;
  let shouldStickToBottom = true;
  let bottomAnchorTimer: ReturnType<typeof setInterval> | null = null;
  let bottomResizeObserver: ResizeObserver | null = null;
  const daySeparatorRefs = new Map<string, HTMLLIElement>();

  const typing = useTypingPresence({
    draft,
    setDraft,
    activeChannelId,
    sendMessage: send,
  });

  const hasBlockingAttachment = createMemo(() => pendingAttachments().some((attachment) => (
    attachment.status === "uploading"
  )));
  const hasFailedAttachment = createMemo(() => pendingAttachments().some((attachment) => attachment.status === "failed"));

  const [activeChannel] = createResource(activeChannelId, fetchActiveChannel);

  const groupedMessages = createMemo<MessageDayGroup[]>(() => {
    const groups: MessageDayGroup[] = [];
    for (const message of messages()) {
      const dayKey = getMessageDayKey(message.created_at);
      const previousGroup = groups[groups.length - 1];
      if (!previousGroup || previousGroup.key !== dayKey) {
        groups.push({ key: dayKey, label: formatMessageDayLabel(dayKey), messages: [message] });
        continue;
      }
      previousGroup.messages.push(message);
    }
    return groups;
  });

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
      const updated = await patch<EditedMessageResponse>(`/messages/${messageId}`, { content });
      setMessages((current) => current.map((message) => (
        message.id === updated.id ? { ...message, content: updated.content, edited_at: updated.edited_at } : message
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

    if (!window.confirm("Delete this message?")) {
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

  function removePendingAttachment(clientId: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.client_id !== clientId));
  }

  function upsertPendingAttachment(clientId: string, next: Partial<PendingAttachment>) {
    setPendingAttachments((current) => current.map((attachment) => (
      attachment.client_id === clientId ? { ...attachment, ...next } : attachment
    )));
  }

  async function uploadAttachment(file: File) {
    const validationError = validateImageAttachment(file);
    if (validationError) {
      setWsError(validationError);
      return;
    }

    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setPendingAttachments((current) => [
      ...current,
      {
        client_id: clientId,
        media_id: null,
        filename: file.name,
        mime_type: file.type,
        status: "uploading",
        error: null,
      },
    ]);

    const currentToken = token();
    if (!currentToken) {
      upsertPendingAttachment(clientId, { status: "failed", error: "Not authenticated" });
      return;
    }

    const apiBaseUrl = getApiBaseUrl();
    try {
      const payload = await uploadMediaFile(apiBaseUrl, currentToken, file);
      upsertPendingAttachment(clientId, {
        media_id: payload.id,
        status: payload.status === "ready" ? "ready" : "processing",
        error: null,
      });

      if (payload.status !== "ready") {
        void waitForMediaDerivative(apiBaseUrl, payload.id)
          .then(() => {
            upsertPendingAttachment(clientId, { status: "ready", error: null });
          })
          .catch(() => undefined);
      }
    } catch (error) {
      upsertPendingAttachment(clientId, { status: "failed", error: uploadError(error) });
    }
  }

  function handleAttachmentInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) {
      return;
    }

    setWsError("");
    for (const file of Array.from(files)) {
      void uploadAttachment(file);
    }
    input.value = "";
  }

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

  function clearBottomAnchorTimer() {
    if (!bottomAnchorTimer) {
      return;
    }

    clearInterval(bottomAnchorTimer);
    bottomAnchorTimer = null;
  }

  function clearBottomResizeObserver() {
    bottomResizeObserver?.disconnect();
    bottomResizeObserver = null;
  }

  function isNearBottom(list: HTMLDivElement, threshold = 32) {
    return list.scrollHeight - (list.scrollTop + list.clientHeight) <= threshold;
  }

  function stickToBottomIfNeeded() {
    if (!listRef || !shouldStickToBottom) {
      return;
    }

    setListScrollTopInstant(listRef, listRef.scrollHeight);
    lastKnownScrollTop = listRef.scrollTop;
  }

  function attachBottomResizeObserver() {
    clearBottomResizeObserver();
    if (!listRef || typeof ResizeObserver === "undefined") {
      return;
    }

    bottomResizeObserver = new ResizeObserver(() => {
      queueMicrotask(() => {
        stickToBottomIfNeeded();
      });
    });

    bottomResizeObserver.observe(listRef);
    if (messageItemsRef) {
      bottomResizeObserver.observe(messageItemsRef);
    }
  }

  function startBottomAnchorPulse(channelId: string, requestId: number) {
    clearBottomAnchorTimer();
    let attempts = 0;

    bottomAnchorTimer = setInterval(() => {
      attempts += 1;

      if (!listRef || channelId !== activeChannelId() || requestId !== latestHistoryRequest || !shouldStickToBottom) {
        if (attempts >= 12 || !shouldStickToBottom) {
          clearBottomAnchorTimer();
        }
        return;
      }

      setListScrollTopInstant(listRef, listRef.scrollHeight);
      lastKnownScrollTop = listRef.scrollTop;

      if (attempts >= 12) {
        clearBottomAnchorTimer();
      }
    }, 80);
  }

  function mergeMessagesById(historyChunk: ChannelMessage[], currentMessages: ChannelMessage[]) {
    const mergedById = new Map<string, ChannelMessage>();
    for (const message of historyChunk) {
      mergedById.set(message.id, { ...message, attachments: message.attachments ?? [] });
    }

    for (const message of currentMessages) {
      mergedById.set(message.id, { ...message, attachments: message.attachments ?? [] });
    }

    return Array.from(mergedById.values()).sort((a, b) => (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ));
  }

  async function loadInitialMessages(channelId: string) {
    const requestId = ++latestHistoryRequest;
    setHistoryLoading(true);
    setHistoryError(null);
    setHasOlderMessages(true);

    try {
      const loadedHistory = await fetchMessagesPage(channelId);
      if (requestId !== latestHistoryRequest || channelId !== activeChannelId()) {
        return;
      }

      setHasOlderMessages(loadedHistory.length >= MESSAGE_PAGE_SIZE);
      setMessages((current) => mergeMessagesById(loadedHistory, current));
      shouldStickToBottom = true;

      queueMicrotask(() => {
        if (requestId !== latestHistoryRequest || channelId !== activeChannelId() || !listRef) {
          return;
        }

        setListScrollTopInstant(listRef, listRef.scrollHeight);
        lastKnownScrollTop = listRef.scrollTop;
        hasAnchoredInitialBottom = true;
        requestAnimationFrame(() => {
          if (requestId !== latestHistoryRequest || channelId !== activeChannelId() || !listRef) {
            return;
          }

          setListScrollTopInstant(listRef, listRef.scrollHeight);
          lastKnownScrollTop = listRef.scrollTop;
        });

        startBottomAnchorPulse(channelId, requestId);
        void fillViewportWithHistory(channelId, requestId);
      });
    } catch (error) {
      if (requestId === latestHistoryRequest && channelId === activeChannelId()) {
        setHistoryError(error);
      }
    } finally {
      if (requestId === latestHistoryRequest && channelId === activeChannelId()) {
        setHistoryLoading(false);
      }
    }
  }

  async function loadOlderMessages() {
    const channelId = activeChannelId();
    if (!channelId || loadingOlderMessages() || historyLoading() || !hasOlderMessages()) {
      return;
    }

    const oldestMessage = messages()[0];
    if (!oldestMessage) {
      return;
    }

    const previousScrollHeight = listRef?.scrollHeight ?? 0;
    const previousScrollTop = listRef?.scrollTop ?? 0;

    setLoadingOlderMessages(true);
    try {
      const loadedHistory = await fetchMessagesPage(channelId, oldestMessage.id);
      if (channelId !== activeChannelId()) {
        return;
      }

      if (loadedHistory.length === 0) {
        setHasOlderMessages(false);
        return;
      }

      setHasOlderMessages(loadedHistory.length >= MESSAGE_PAGE_SIZE);
      isPrependingHistory = true;
      setMessages((current) => mergeMessagesById(loadedHistory, current));
      queueMicrotask(() => {
        if (channelId !== activeChannelId() || !listRef) {
          isPrependingHistory = false;
          return;
        }

        const scrollHeightDelta = listRef.scrollHeight - previousScrollHeight;
        setListScrollTopInstant(listRef, previousScrollTop + scrollHeightDelta);
        lastKnownScrollTop = listRef.scrollTop;
        isPrependingHistory = false;
      });
    } catch (error) {
      if (channelId === activeChannelId()) {
        setWsError(errorMessage(error, "Failed to load older messages"));
      }
    } finally {
      if (channelId === activeChannelId()) {
        setLoadingOlderMessages(false);
      }
    }
  }

  async function fillViewportWithHistory(channelId: string, requestId: number) {
    let attempts = 0;

    while (attempts < 10) {
      if (!listRef || channelId !== activeChannelId() || requestId !== latestHistoryRequest || !hasOlderMessages()) {
        return;
      }

      if (listRef.scrollHeight > listRef.clientHeight + 1) {
        return;
      }

      await loadOlderMessages();
      attempts += 1;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }

  function handleTimelineScroll(_event: Event) {
    updateStickyDate();
    if (!listRef) {
      return;
    }

    shouldStickToBottom = isNearBottom(listRef);
    const currentScrollTop = listRef.scrollTop;
    const isScrollingUp = currentScrollTop < lastKnownScrollTop;
    lastKnownScrollTop = currentScrollTop;

    if (!hasAnchoredInitialBottom || !isScrollingUp) {
      return;
    }

    if (!listRef || listRef.scrollTop > 120) {
      return;
    }

    void loadOlderMessages();
  }

  function handleSubmit(event: Event) {
    event.preventDefault();
    setWsError("");

    const channelId = activeChannelId();
    const content = draft().trim();
    const attachmentIds = pendingAttachments()
      .filter((attachment) => attachment.status !== "uploading" && attachment.status !== "failed" && attachment.media_id)
      .map((attachment) => attachment.media_id as string);

    if (!channelId || hasBlockingAttachment() || hasFailedAttachment()) {
      return;
    }

    if (!content && attachmentIds.length === 0) {
      return;
    }

    setIsSending(true);
    send({ type: "send_message", channel_id: channelId, content, attachment_media_ids: attachmentIds });
    typing.stopTypingBroadcast();
    setDraft("");
    setPendingAttachments([]);
    queueMicrotask(() => setIsSending(false));
  }

  onMount(() => {
    connect();

    void get<UsersResponse>("/users")
      .then((response) => {
        if (response.users) {
          setUserProfiles(response.users);
        }
      })
      .catch(() => undefined);

    registerContextMenuHandlers({
      message: {
        onEdit: (messageData) => {
          const message = messages().find((entry) => entry.id === messageData.id);
          if (message) {
            beginEdit(message);
          }
        },
        onDelete: (messageData) => {
          const message = messages().find((entry) => entry.id === messageData.id);
          if (message) {
            void removeMessage(message);
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
        upsertUserProfile({ username: msg.author_username, avatar_url: null });
        typing.removeTypingUser(msg.author_username);
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
              attachments: msg.attachments ?? [],
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
          message.id === msg.id ? { ...message, content: msg.content, edited_at: msg.edited_at } : message
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
        typing.touchTypingUser(msg.username);
        return;
      }

      if (msg.type === "typing_stop" && msg.channel_id === activeChannelId()) {
        typing.removeTypingUser(msg.username);
      }
    });

    onCleanup(() => {
      clearBottomAnchorTimer();
      clearBottomResizeObserver();
      typing.dispose();
      unsubscribe();
    });
  });

  createEffect(() => {
    const channelId = activeChannelId();
    typing.handleChannelChanged(channelId);
    setMessages([]);
    cancelEdit();
    setDeletingMessageId(null);
    setPendingAttachments([]);
    setWsError("");
    setHistoryError(null);
    setHistoryLoading(false);
    setLoadingOlderMessages(false);
    setHasOlderMessages(true);
    previousMessageCount = 0;
    latestHistoryRequest += 1;
    isPrependingHistory = false;
    hasAnchoredInitialBottom = false;
    lastKnownScrollTop = 0;
    shouldStickToBottom = true;
    clearBottomAnchorTimer();
    daySeparatorRefs.clear();
    setStickyDateLabel("");

    if (channelId) {
      send({ type: "subscribe_channel", channel_id: channelId });
      void loadInitialMessages(channelId);
    }
  });

  createEffect(() => {
    const nextMessages = messages();
    const count = nextMessages.length;
    if (count > previousMessageCount && !isPrependingHistory && shouldStickToBottom) {
      queueMicrotask(() => {
        if (listRef) {
          setListScrollTopInstant(listRef, listRef.scrollHeight);
          lastKnownScrollTop = listRef.scrollTop;
        }
      });
    }
    previousMessageCount = count;
    queueMicrotask(updateStickyDate);
  });

  createEffect(() => {
    groupedMessages();
    queueMicrotask(updateStickyDate);
  });

  return (
    <div class="message-area">
      <MessageTimeline
        activeChannel={activeChannel()}
        loading={historyLoading()}
        error={historyError()}
        groupedMessages={groupedMessages()}
        stickyDateLabel={stickyDateLabel()}
        loadingOlderMessages={loadingOlderMessages()}
        hasOlderMessages={hasOlderMessages()}
        editingMessageId={editingMessageId()}
        editDraft={editDraft()}
        savingMessageId={savingMessageId()}
        deletingMessageId={deletingMessageId()}
        onScroll={handleTimelineScroll}
        onListRef={(element) => {
          listRef = element;
          lastKnownScrollTop = element.scrollTop;
          attachBottomResizeObserver();
        }}
        onItemsRef={(element) => {
          messageItemsRef = element;
          attachBottomResizeObserver();
        }}
        onDaySeparatorRef={(key, element) => {
          daySeparatorRefs.set(key, element);
        }}
        onBeginEdit={beginEdit}
        onRemoveMessage={(message) => {
          void removeMessage(message);
        }}
        onSaveEdit={(messageId) => {
          void saveEdit(messageId);
        }}
        onCancelEdit={cancelEdit}
        onEditDraftInput={setEditDraft}
        toAbsoluteMediaUrl={(path) => toAbsoluteMediaUrl(getApiBaseUrl(), path)}
      />
      <VideoStage />
      <MessageComposer
        activeChannelId={activeChannelId()}
        draft={draft()}
        isSending={isSending()}
        savingMessageId={savingMessageId()}
        deletingMessageId={deletingMessageId()}
        pendingAttachments={pendingAttachments()}
        hasBlockingAttachment={hasBlockingAttachment()}
        hasFailedAttachment={hasFailedAttachment()}
        onSubmit={handleSubmit}
        onDraftInput={typing.handleDraftInput}
        onAttachmentInput={handleAttachmentInput}
        onRemoveAttachment={removePendingAttachment}
      />
      <Show when={typing.typingUsernames().length > 0}>
        <p class="typing-indicator">{typingText(typing.typingUsernames())}</p>
      </Show>
      <Show when={wsError()}>
        <p class="error message-error">{wsError()}</p>
      </Show>
    </div>
  );
}
