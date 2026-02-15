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
  const [editingMessageId, setEditingMessageId] = createSignal<string | null>(null);
  const [editDraft, setEditDraft] = createSignal("");
  const [savingMessageId, setSavingMessageId] = createSignal<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = createSignal<string | null>(null);
  const [isSending, setIsSending] = createSignal(false);
  const [stickyDateLabel, setStickyDateLabel] = createSignal("");
  const [pendingAttachments, setPendingAttachments] = createSignal<PendingAttachment[]>([]);

  let listRef: HTMLDivElement | undefined;
  let previousMessageCount = 0;
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

  const [history] = createResource(activeChannelId, fetchMessages);
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
    previousMessageCount = 0;
    daySeparatorRefs.clear();
    setStickyDateLabel("");

    if (channelId) {
      send({ type: "subscribe_channel", channel_id: channelId });
    }
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
        mergedById.set(message.id, { ...message, attachments: message.attachments ?? [] });
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
        loading={history.loading}
        error={history.error}
        groupedMessages={groupedMessages()}
        stickyDateLabel={stickyDateLabel()}
        editingMessageId={editingMessageId()}
        editDraft={editDraft()}
        savingMessageId={savingMessageId()}
        deletingMessageId={deletingMessageId()}
        onScroll={updateStickyDate}
        onListRef={(element) => {
          listRef = element;
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
