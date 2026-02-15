import { createSignal, type Accessor } from "solid-js";

interface UseTypingPresenceOptions {
  draft: Accessor<string>;
  setDraft: (value: string) => void;
  activeChannelId: Accessor<string | null>;
  sendMessage: (payload: unknown) => void;
}

export function useTypingPresence(options: UseTypingPresenceOptions) {
  const [typingUsernames, setTypingUsernames] = createSignal<string[]>([]);

  let activeTypingChannelId: string | null = null;
  let typingHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTypingExpiryTimer(typingUsername: string) {
    const timer = typingExpiryTimers.get(typingUsername);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    typingExpiryTimers.delete(typingUsername);
  }

  function removeTypingUser(typingUsername: string) {
    clearTypingExpiryTimer(typingUsername);
    setTypingUsernames((current) => current.filter((entry) => entry !== typingUsername));
  }

  function touchTypingUser(typingUsername: string) {
    setTypingUsernames((current) => (current.includes(typingUsername) ? current : [...current, typingUsername]));
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
    if (typingHeartbeatTimer) {
      clearInterval(typingHeartbeatTimer);
      typingHeartbeatTimer = null;
    }

    if (activeTypingChannelId) {
      options.sendMessage({ type: "typing_stop", channel_id: activeTypingChannelId });
      activeTypingChannelId = null;
    }
  }

  function startTypingHeartbeat() {
    if (typingHeartbeatTimer) {
      return;
    }

    typingHeartbeatTimer = setInterval(() => {
      const channelId = options.activeChannelId();
      const hasDraft = options.draft().trim().length > 0;
      if (!channelId || !hasDraft || activeTypingChannelId !== channelId) {
        return;
      }
      options.sendMessage({ type: "typing_start", channel_id: channelId });
    }, 2000);
  }

  function handleDraftInput(value: string) {
    options.setDraft(value);
    const channelId = options.activeChannelId();
    const hasContent = value.trim().length > 0;
    if (!channelId || !hasContent) {
      stopTypingBroadcast();
      return;
    }

    if (activeTypingChannelId !== channelId) {
      stopTypingBroadcast();
      options.sendMessage({ type: "typing_start", channel_id: channelId });
      activeTypingChannelId = channelId;
    }

    startTypingHeartbeat();
  }

  function handleChannelChanged(nextChannelId: string | null) {
    if (activeTypingChannelId && activeTypingChannelId !== nextChannelId) {
      stopTypingBroadcast();
    }
    clearTypingUsers();
  }

  function dispose() {
    stopTypingBroadcast();
    clearTypingUsers();
  }

  return {
    typingUsernames,
    touchTypingUser,
    removeTypingUser,
    clearTypingUsers,
    stopTypingBroadcast,
    handleDraftInput,
    handleChannelChanged,
    dispose,
  };
}
