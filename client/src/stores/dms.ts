import { createSignal } from "solid-js";
import type { DmThreadSummary } from "../api/dms";

export type DmThread = DmThreadSummary;

const [threadsById, setThreadsById] = createSignal<Record<string, DmThread>>({});
const [threadOrder, setThreadOrder] = createSignal<string[]>([]);
const [typingByThread, setTypingByThread] = createSignal<Record<string, string[]>>({});

const DM_TYPING_TTL_MS = 3000;
const dmTypingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function dmTypingTimerKey(threadId: string, typingUsername: string) {
  return `${threadId}:${typingUsername}`;
}

function clearDmTypingExpiry(threadId: string, typingUsername: string) {
  const key = dmTypingTimerKey(threadId, typingUsername);
  const timer = dmTypingExpiryTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    dmTypingExpiryTimers.delete(key);
  }
}

function scheduleDmTypingExpiry(threadId: string, typingUsername: string) {
  clearDmTypingExpiry(threadId, typingUsername);
  const key = dmTypingTimerKey(threadId, typingUsername);
  const timer = setTimeout(() => {
    removeDmTypingUser(threadId, typingUsername);
  }, DM_TYPING_TTL_MS);
  dmTypingExpiryTimers.set(key, timer);
}

function sortThreadOrder(nextById: Record<string, DmThread>) {
  const ids = Object.keys(nextById);
  ids.sort((left, right) => {
    const leftAt = nextById[left].last_message_at;
    const rightAt = nextById[right].last_message_at;
    if (!leftAt && !rightAt) {
      return nextById[left].other_username.localeCompare(nextById[right].other_username);
    }
    if (!leftAt) {
      return 1;
    }
    if (!rightAt) {
      return -1;
    }
    return new Date(rightAt).getTime() - new Date(leftAt).getTime();
  });
  return ids;
}

export function dmThreads() {
  const byId = threadsById();
  return threadOrder().map((threadId) => byId[threadId]).filter(Boolean);
}

export function dmThreadById(threadId: string | null): DmThread | null {
  if (!threadId) {
    return null;
  }
  return threadsById()[threadId] ?? null;
}

export function setDmThreads(threads: DmThread[]) {
  const nextById: Record<string, DmThread> = {};
  for (const thread of threads) {
    nextById[thread.thread_id] = thread;
  }
  setThreadsById(nextById);
  setThreadOrder(sortThreadOrder(nextById));
}

export function upsertDmThread(thread: DmThread) {
  setThreadsById((current) => {
    const nextById = {
      ...current,
      [thread.thread_id]: {
        ...current[thread.thread_id],
        ...thread,
      },
    };
    setThreadOrder(sortThreadOrder(nextById));
    return nextById;
  });
}

export function updateDmThreadActivity(
  threadId: string,
  lastMessageId: string | null,
  lastMessagePreview: string | null,
  lastMessageAt: string | null,
) {
  setThreadsById((current) => {
    const existing = current[threadId];
    if (!existing) {
      return current;
    }

    const nextById = {
      ...current,
      [threadId]: {
        ...existing,
        last_message_id: lastMessageId,
        last_message_preview: lastMessagePreview,
        last_message_at: lastMessageAt,
      },
    };
    setThreadOrder(sortThreadOrder(nextById));
    return nextById;
  });
}

export function setDmUnreadCount(threadId: string, unreadCount: number) {
  setThreadsById((current) => {
    const existing = current[threadId];
    if (!existing) {
      return current;
    }
    return {
      ...current,
      [threadId]: {
        ...existing,
        unread_count: Math.max(0, unreadCount),
      },
    };
  });
}

export function touchDmTypingUser(threadId: string, typingUsername: string) {
  scheduleDmTypingExpiry(threadId, typingUsername);
  setTypingByThread((current) => {
    const currentUsers = current[threadId] ?? [];
    if (currentUsers.includes(typingUsername)) {
      return current;
    }
    return {
      ...current,
      [threadId]: [...currentUsers, typingUsername],
    };
  });
}

export function removeDmTypingUser(threadId: string, typingUsername: string) {
  clearDmTypingExpiry(threadId, typingUsername);
  setTypingByThread((current) => {
    const currentUsers = current[threadId] ?? [];
    if (!currentUsers.includes(typingUsername)) {
      return current;
    }

    const nextUsers = currentUsers.filter((entry) => entry !== typingUsername);
    if (nextUsers.length === 0) {
      const { [threadId]: _, ...next } = current;
      return next;
    }

    return {
      ...current,
      [threadId]: nextUsers,
    };
  });
}

export function clearDmTypingUsers(threadId: string) {
  const prefix = `${threadId}:`;
  for (const [key, timer] of dmTypingExpiryTimers.entries()) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      dmTypingExpiryTimers.delete(key);
    }
  }

  setTypingByThread((current) => {
    if (!current[threadId]) {
      return current;
    }
    const { [threadId]: _, ...next } = current;
    return next;
  });
}

export function dmTypingUsernames(threadId: string | null): string[] {
  if (!threadId) {
    return [];
  }
  return typingByThread()[threadId] ?? [];
}

export function resetDmState() {
  for (const timer of dmTypingExpiryTimers.values()) {
    clearTimeout(timer);
  }
  dmTypingExpiryTimers.clear();

  setThreadsById({});
  setThreadOrder([]);
  setTypingByThread({});
}
