import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { del, get, patch } from "../api/http";
import { deleteDmMessage, editDmMessage, fetchDmMessages, markDmRead } from "../api/dms";
import { connect, onMessage, send } from "../api/ws";
import { addReaction, removeCustomReaction, removeUnicodeReaction } from "../api/reactions";
import type { GifResult } from "../api/gifs";
import { getApiBaseUrl, token, userId, username } from "../stores/auth";
import { activeChannelId, activeDmThreadId, type Channel } from "../stores/chat";
import { registerContextMenuHandlers } from "../stores/contextMenu";
import {
  displayNameFor,
  knownUsernames,
  setUserProfiles,
  upsertUserProfile,
} from "../stores/userProfiles";
import { errorMessage } from "../utils/error";
import { isMentioningUsername } from "../utils/mentions";
import { mentionDesktopNotificationsEnabled } from "../stores/settings";
import MessageComposer from "./MessageComposer";
import MessageTimeline from "./MessageTimeline";
import VideoStage from "./VideoStage";
import StreamWatchOverlay from "./StreamWatchOverlay";
import { isStreamWatchFocused } from "../stores/voice";
import { useTypingPresence } from "./useTypingPresence";
import { clearDmTypingUsers, dmThreadById, dmTypingUsernames, removeDmTypingUser, setDmUnreadCount, touchDmTypingUser } from "../stores/dms";
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
  type MessageReaction,
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

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }

  return "img";
}

function filenameFromImageSource(src: string, mimeType: string, index: number): string {
  try {
    const parsed = new URL(src);
    const pathname = parsed.pathname || "";
    const candidate = pathname.split("/").pop()?.trim();
    if (candidate) {
      return decodeURIComponent(candidate);
    }
  } catch {
    // fall back to generated name
  }

  return `pasted-image-${Date.now()}-${index}.${extensionFromMimeType(mimeType)}`;
}

async function clipboardHtmlImageFiles(clipboard: DataTransfer): Promise<File[]> {
  const html = clipboard.getData("text/html");
  if (!html) {
    return [];
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const sources = Array.from(document.querySelectorAll("img"))
    .map((image) => image.getAttribute("src")?.trim() ?? "")
    .filter((src) => src.length > 0);

  const uniqueSources = Array.from(new Set(sources));
  const fetchedFiles = await Promise.all(uniqueSources.map(async (source, index) => {
    try {
      const response = await fetch(source);
      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        return null;
      }

      const filename = filenameFromImageSource(source, blob.type, index + 1);
      return new File([blob], filename, { type: blob.type });
    } catch {
      return null;
    }
  }));

  return fetchedFiles.filter((file): file is File => !!file);
}

async function extractPastedImageFiles(event: ClipboardEvent): Promise<File[]> {
  const clipboard = event.clipboardData;
  if (!clipboard) {
    return [];
  }

  const imageFiles: File[] = [];
  const dedupe = new Set<string>();

  function maybeAddImage(file: File | null) {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    const key = `${file.name}:${file.size}:${file.type}`;
    if (dedupe.has(key)) {
      return;
    }

    dedupe.add(key);
    imageFiles.push(file);
  }

  for (const file of Array.from(clipboard.files)) {
    maybeAddImage(file);
  }

  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== "file") {
      continue;
    }

    maybeAddImage(item.getAsFile());
  }

  if (imageFiles.length > 0) {
    return imageFiles;
  }

  const htmlImageFiles = await clipboardHtmlImageFiles(clipboard);
  for (const file of htmlImageFiles) {
    maybeAddImage(file);
  }

  return imageFiles;
}

async function fetchMessagesPage(
  target: { kind: "channel"; id: string } | { kind: "dm"; id: string },
  before?: string,
) {
  if (target.kind === "channel") {
    const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
    if (before) {
      params.set("before", before);
    }

    return get<ChannelMessage[]>(`/channels/${target.id}/messages?${params.toString()}`);
  }

  const messages = await fetchDmMessages(target.id, before, MESSAGE_PAGE_SIZE);
  return messages.map((message) => ({
    ...message,
    channel_id: message.thread_id,
    attachments: [],
    reactions: [],
  }));
}

function setListScrollTopInstant(list: HTMLDivElement, top: number) {
  list.scrollTo({ top, behavior: "auto" });
}

async function fetchActiveChannel(target: { kind: "channel"; id: string } | { kind: "dm"; id: string } | null) {
  if (!target) {
    return null;
  }

  if (target.kind === "dm") {
    const thread = dmThreadById(target.id);
    if (!thread) {
      return null;
    }
    return {
      id: thread.thread_id,
      name: thread.other_display_name,
      description: thread.last_message_preview,
      kind: "text" as const,
      position: 0,
      created_at: thread.last_message_at ?? new Date().toISOString(),
    };
  }

  return get<Channel>(`/channels/${target.id}`);
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

  const activeTarget = createMemo<
    { kind: "channel"; id: string } | { kind: "dm"; id: string } | null
  >(() => {
    const dmThreadId = activeDmThreadId();
    if (dmThreadId) {
      return { kind: "dm", id: dmThreadId };
    }

    const channelId = activeChannelId();
    if (channelId) {
      return { kind: "channel", id: channelId };
    }

    return null;
  });

  const typing = useTypingPresence({
    draft,
    setDraft,
    activeChannelId: () => activeTarget()?.id ?? null,
    sendMessage: send,
    typingStartPayload: (contextId) => (
      activeTarget()?.kind === "dm"
        ? { type: "typing_start_dm", thread_id: contextId }
        : { type: "typing_start", channel_id: contextId }
    ),
    typingStopPayload: (contextId) => (
      activeTarget()?.kind === "dm"
        ? { type: "typing_stop_dm", thread_id: contextId }
        : { type: "typing_stop", channel_id: contextId }
    ),
  });

  const hasBlockingAttachment = createMemo(() => pendingAttachments().some((attachment) => (
    attachment.status === "uploading"
  )));
  const hasFailedAttachment = createMemo(() => pendingAttachments().some((attachment) => attachment.status === "failed"));

  const [activeChannel] = createResource(activeTarget, fetchActiveChannel);

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

  function normalizeMessage(message: ChannelMessage): ChannelMessage {
    return {
      ...message,
      attachments: message.attachments ?? [],
      reactions: message.reactions ?? [],
    };
  }

  function reactionMatches(
    reaction: MessageReaction,
    emojiId: string | null | undefined,
    unicodeEmoji: string | null | undefined,
  ): boolean {
    return reaction.emoji_id === (emojiId ?? null)
      && reaction.unicode_emoji === (unicodeEmoji ?? null);
  }

  function updateMessageReactionState(
    messageId: string,
    updater: (reactions: MessageReaction[]) => MessageReaction[],
  ) {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) {
        return message;
      }

      return {
        ...message,
        reactions: updater(message.reactions ?? []),
      };
    }));
  }

  async function handleAddReaction(messageId: string, reaction: { emoji_id?: string; unicode_emoji?: string }) {
    try {
      await addReaction(messageId, reaction);
    } catch (error) {
      setWsError(errorMessage(error, "Failed to add reaction"));
    }
  }

  async function handleRemoveReaction(messageId: string, reaction: MessageReaction) {
    try {
      if (reaction.emoji_id) {
        await removeCustomReaction(messageId, reaction.emoji_id);
      } else if (reaction.unicode_emoji) {
        await removeUnicodeReaction(messageId, reaction.unicode_emoji);
      }
    } catch (error) {
      setWsError(errorMessage(error, "Failed to remove reaction"));
    }
  }

  function handleGifSelect(gif: GifResult) {
    const trimmed = draft().trim();
    const nextDraft = trimmed.length > 0 ? `${trimmed} ${gif.url}` : gif.url;
    typing.handleDraftInput(nextDraft);
  }

  function beginEdit(message: ChannelMessage) {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
    setWsError("");
  }

  function maybeShowMentionDesktopNotification(message: {
    id: string;
    author_username: string;
    author_display_name: string;
    content: string;
    channel_id: string;
  }) {
    const currentUsername = username();
    if (!currentUsername) {
      return;
    }

    if (!isMentioningUsername(message.content, currentUsername)) {
      return;
    }

    const isWindowFocused = document.visibilityState === "visible" && document.hasFocus();
    const isCurrentChannel = message.channel_id === activeChannelId();
    if (isWindowFocused && isCurrentChannel) {
      return;
    }

    if (!mentionDesktopNotificationsEnabled() || typeof Notification === "undefined") {
      return;
    }

    if (Notification.permission !== "granted") {
      return;
    }

    const body = message.content.trim().length > 0
      ? message.content.trim()
      : "You were mentioned in a new message.";
    const notification = new Notification(`@${currentUsername} mention from ${message.author_display_name}`, {
      body,
      tag: `mention-${message.id}`,
    });

    notification.onclick = () => {
      window.focus();
    };
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
      const target = activeTarget();
      const updated = target?.kind === "dm"
        ? await editDmMessage(messageId, content)
        : await patch<EditedMessageResponse>(`/messages/${messageId}`, { content });
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
      if (activeTarget()?.kind === "dm") {
        await deleteDmMessage(message.id);
      } else {
        await del<{ deleted: true }>(`/messages/${message.id}`);
      }
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
        void waitForMediaDerivative(apiBaseUrl, currentToken, payload.id)
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
    if (activeTarget()?.kind === "dm") {
      setWsError("Attachments are not available in DMs yet.");
      const input = event.currentTarget as HTMLInputElement;
      input.value = "";
      return;
    }

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

  async function handleDraftPaste(event: ClipboardEvent) {
    if (!activeTarget() || isSending() || savingMessageId() || deletingMessageId()) {
      return;
    }

    if (activeTarget()?.kind === "dm") {
      return;
    }

    const files = await extractPastedImageFiles(event);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    setWsError("");
    for (const file of files) {
      void uploadAttachment(file);
    }
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

  function startBottomAnchorPulse(expectedTargetKey: string, requestId: number) {
    clearBottomAnchorTimer();
    let attempts = 0;

    bottomAnchorTimer = setInterval(() => {
      attempts += 1;

      if (!listRef || expectedTargetKey !== targetKey(activeTarget()) || requestId !== latestHistoryRequest || !shouldStickToBottom) {
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
      mergedById.set(message.id, normalizeMessage(message));
    }

    for (const message of currentMessages) {
      mergedById.set(message.id, normalizeMessage(message));
    }

    return Array.from(mergedById.values()).sort((a, b) => (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ));
  }

  function targetKey(target: { kind: "channel"; id: string } | { kind: "dm"; id: string } | null): string | null {
    if (!target) {
      return null;
    }
    return `${target.kind}:${target.id}`;
  }

  async function loadInitialMessages(target: { kind: "channel"; id: string } | { kind: "dm"; id: string }) {
    const requestId = ++latestHistoryRequest;
    const requestedTargetKey = `${target.kind}:${target.id}`;
    setHistoryLoading(true);
    setHistoryError(null);
    setHasOlderMessages(true);

    try {
      const loadedHistory = await fetchMessagesPage(target);
      if (requestId !== latestHistoryRequest || requestedTargetKey !== targetKey(activeTarget())) {
        return;
      }

      setHasOlderMessages(loadedHistory.length >= MESSAGE_PAGE_SIZE);
      setMessages((current) => mergeMessagesById(loadedHistory, current));
      shouldStickToBottom = true;

      queueMicrotask(() => {
        if (requestId !== latestHistoryRequest || requestedTargetKey !== targetKey(activeTarget()) || !listRef) {
          return;
        }

        setListScrollTopInstant(listRef, listRef.scrollHeight);
        lastKnownScrollTop = listRef.scrollTop;
        hasAnchoredInitialBottom = true;
        requestAnimationFrame(() => {
          if (requestId !== latestHistoryRequest || requestedTargetKey !== targetKey(activeTarget()) || !listRef) {
            return;
          }

          setListScrollTopInstant(listRef, listRef.scrollHeight);
          lastKnownScrollTop = listRef.scrollTop;
        });

        startBottomAnchorPulse(requestedTargetKey, requestId);
        void fillViewportWithHistory(requestedTargetKey, requestId);
      });
    } catch (error) {
      if (requestId === latestHistoryRequest && requestedTargetKey === targetKey(activeTarget())) {
        setHistoryError(error);
      }
    } finally {
      if (requestId === latestHistoryRequest && requestedTargetKey === targetKey(activeTarget())) {
        setHistoryLoading(false);
      }
    }
  }

  async function loadOlderMessages() {
    const target = activeTarget();
    const currentTargetKey = targetKey(target);
    if (!target || !currentTargetKey || loadingOlderMessages() || historyLoading() || !hasOlderMessages()) {
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
      const loadedHistory = await fetchMessagesPage(target, oldestMessage.id);
      if (currentTargetKey !== targetKey(activeTarget())) {
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
        if (currentTargetKey !== targetKey(activeTarget()) || !listRef) {
          isPrependingHistory = false;
          return;
        }

        const scrollHeightDelta = listRef.scrollHeight - previousScrollHeight;
        setListScrollTopInstant(listRef, previousScrollTop + scrollHeightDelta);
        lastKnownScrollTop = listRef.scrollTop;
        isPrependingHistory = false;
      });
    } catch (error) {
      if (currentTargetKey === targetKey(activeTarget())) {
        setWsError(errorMessage(error, "Failed to load older messages"));
      }
    } finally {
      if (currentTargetKey === targetKey(activeTarget())) {
        setLoadingOlderMessages(false);
      }
    }
  }

  async function fillViewportWithHistory(expectedTargetKey: string, requestId: number) {
    let attempts = 0;

    while (attempts < 10) {
      if (!listRef || expectedTargetKey !== targetKey(activeTarget()) || requestId !== latestHistoryRequest || !hasOlderMessages()) {
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

    const target = activeTarget();
    const content = draft().trim();
    const attachmentIds = pendingAttachments()
      .filter((attachment) => attachment.status !== "uploading" && attachment.status !== "failed" && attachment.media_id)
      .map((attachment) => attachment.media_id as string);

    if (!target || hasBlockingAttachment() || hasFailedAttachment()) {
      return;
    }

    if (target.kind === "dm" && attachmentIds.length > 0) {
      setWsError("Attachments are not available in DMs yet.");
      return;
    }

    if (!content && attachmentIds.length === 0) {
      return;
    }

    const selfUsername = username();
    if (selfUsername && isMentioningUsername(content, selfUsername)) {
      setWsError("You cannot mention yourself.");
      return;
    }

    setIsSending(true);
    if (target.kind === "dm") {
      send({ type: "send_dm_message", thread_id: target.id, content });
    } else {
      send({ type: "send_message", channel_id: target.id, content, attachment_media_ids: attachmentIds });
    }
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
        upsertUserProfile({
          username: msg.author_username,
          display_name: msg.author_display_name,
          avatar_url: null,
        });
        typing.removeTypingUser(msg.author_username);

        const selfUsername = username();
        const isOwnMessage = selfUsername ? msg.author_username === selfUsername : false;
        if (!isOwnMessage) {
          maybeShowMentionDesktopNotification(msg);
        }

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
              author_display_name: msg.author_display_name,
              content: msg.content,
              created_at: msg.created_at,
              edited_at: msg.edited_at ?? null,
              attachments: msg.attachments ?? [],
              reactions: [],
            },
          ];
        });
        return;
      }

      if (msg.type === "new_dm_message") {
        upsertUserProfile({
          username: msg.author_username,
          display_name: msg.author_display_name,
          avatar_url: null,
        });

        removeDmTypingUser(msg.thread_id, msg.author_username);

        if (msg.thread_id !== activeDmThreadId()) {
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
              channel_id: msg.thread_id,
              author_id: msg.author_id,
              author_username: msg.author_username,
              author_display_name: msg.author_display_name,
              content: msg.content,
              created_at: msg.created_at,
              edited_at: msg.edited_at ?? null,
              attachments: [],
              reactions: [],
            },
          ];
        });

        void markDmRead(msg.thread_id, msg.id).catch(() => undefined);
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

      if (msg.type === "dm_message_edited") {
        if (msg.thread_id !== activeDmThreadId()) {
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

      if (msg.type === "dm_message_deleted") {
        if (msg.thread_id !== activeDmThreadId()) {
          return;
        }
        setMessages((current) => current.filter((message) => message.id !== msg.id));
        if (editingMessageId() === msg.id) {
          cancelEdit();
        }
        return;
      }

      if (msg.type === "reaction_added") {
        if (msg.channel_id !== activeChannelId()) {
          return;
        }

        const currentUserId = userId();
        updateMessageReactionState(msg.message_id, (reactions) => {
          const matchIndex = reactions.findIndex((reaction) => reactionMatches(reaction, msg.emoji_id, msg.unicode_emoji));
          if (matchIndex === -1) {
            return [
              ...reactions,
              {
                emoji_id: msg.emoji_id,
                unicode_emoji: msg.unicode_emoji,
                shortcode: msg.shortcode,
                count: msg.count,
                user_reacted: currentUserId ? msg.user_id === currentUserId : false,
              },
            ];
          }

          const next = [...reactions];
          const current = next[matchIndex];
          next[matchIndex] = {
            ...current,
            shortcode: current.shortcode ?? msg.shortcode,
            count: msg.count,
            user_reacted: current.user_reacted || (currentUserId ? msg.user_id === currentUserId : false),
          };
          return next;
        });
        return;
      }

      if (msg.type === "reaction_removed") {
        if (msg.channel_id !== activeChannelId()) {
          return;
        }

        const currentUserId = userId();
        updateMessageReactionState(msg.message_id, (reactions) => {
          const matchIndex = reactions.findIndex((reaction) => reactionMatches(reaction, msg.emoji_id, msg.unicode_emoji));
          if (matchIndex === -1) {
            return reactions;
          }

          if (msg.count <= 0) {
            return reactions.filter((_, index) => index !== matchIndex);
          }

          const next = [...reactions];
          const current = next[matchIndex];
          const removedByCurrentUser = !!currentUserId && msg.user_id === currentUserId;
          next[matchIndex] = {
            ...current,
            count: msg.count,
            user_reacted: removedByCurrentUser ? false : current.user_reacted,
          };
          return next;
        });
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
        return;
      }

      if (msg.type === "dm_typing_start") {
        if (msg.thread_id !== activeDmThreadId() || msg.username === username()) {
          return;
        }
        touchDmTypingUser(msg.thread_id, msg.username);
        return;
      }

      if (msg.type === "dm_typing_stop") {
        removeDmTypingUser(msg.thread_id, msg.username);
        return;
      }

      if (msg.type === "dm_unread_updated") {
        if (msg.thread_id === activeDmThreadId()) {
          setDmUnreadCount(msg.thread_id, 0);
        }
        return;
      }

      if (msg.type === "user_profile_updated") {
        upsertUserProfile({
          username: msg.username,
          display_name: msg.display_name,
          avatar_url: msg.avatar_url,
          profile_description: msg.profile_description,
          profile_status: msg.profile_status,
        });
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
    const target = activeTarget();
    typing.handleChannelChanged(target?.id ?? null);
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

    if (target) {
      if (target.kind === "dm") {
        send({ type: "subscribe_dm", thread_id: target.id });
        clearDmTypingUsers(target.id);
        setDmUnreadCount(target.id, 0);
      } else {
        send({ type: "subscribe_channel", channel_id: target.id });
      }
      void loadInitialMessages(target);
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

  createEffect(() => {
    const threadId = activeDmThreadId();
    if (!threadId) {
      return;
    }

    const latestMessage = messages()[messages().length - 1];
    if (!latestMessage) {
      return;
    }

    void markDmRead(threadId, latestMessage.id).catch(() => undefined);
    setDmUnreadCount(threadId, 0);
  });

  const visibleTypingUsernames = createMemo(() => {
    const threadId = activeDmThreadId();
    if (threadId) {
      return dmTypingUsernames(threadId);
    }

    return typing.typingUsernames();
  });

  return (
    <div class={`message-area${isStreamWatchFocused() ? " is-stream-focused" : ""}`}>
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
        onAddReaction={(messageId, reaction) => {
          void handleAddReaction(messageId, reaction);
        }}
        onRemoveReaction={(messageId, reaction) => {
          void handleRemoveReaction(messageId, reaction);
        }}
        toAbsoluteMediaUrl={(path) => toAbsoluteMediaUrl(getApiBaseUrl(), path)}
      />
      <VideoStage />
      <MessageComposer
        activeChannelId={activeTarget()?.id ?? null}
        draft={draft()}
        isSending={isSending()}
        savingMessageId={savingMessageId()}
        deletingMessageId={deletingMessageId()}
        pendingAttachments={pendingAttachments()}
        hasBlockingAttachment={hasBlockingAttachment()}
        hasFailedAttachment={hasFailedAttachment()}
        mentionUsernames={knownUsernames().filter((entry) => {
          const selfUsername = username();
          return !selfUsername || entry.toLowerCase() !== selfUsername.toLowerCase();
        })}
        onSubmit={handleSubmit}
        onDraftInput={typing.handleDraftInput}
        onAttachmentInput={handleAttachmentInput}
        onDraftPaste={(event) => {
          void handleDraftPaste(event);
        }}
        onRemoveAttachment={removePendingAttachment}
        onGifSelect={handleGifSelect}
      />
        <Show when={visibleTypingUsernames().length > 0}>
        <p class="typing-indicator">{typingText(visibleTypingUsernames().map((entry) => displayNameFor(entry)))}</p>
      </Show>
      <Show when={wsError()}>
        <p class="error message-error">{wsError()}</p>
      </Show>
      <StreamWatchOverlay />
    </div>
  );
}
