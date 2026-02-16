import { clearAuthSession, getWsUrl, token } from "../stores/auth";
import type { Channel } from "../stores/chat";

export interface MessageAttachment {
  media_id: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  status: "processing" | "ready" | "failed";
  thumbnail_url: string | null;
  display_url: string | null;
  original_url: string;
}

export type PresenceStatus = "online" | "idle";

export interface PresenceUser {
  username: string;
  status: PresenceStatus;
}

export type ServerMessage =
  | { type: "authenticated"; user_id: string; username: string; role: string }
  | { type: "error"; message: string }
  | { type: "presence_snapshot"; users: PresenceUser[] }
  | { type: "user_connected"; username: string; status?: PresenceStatus }
  | { type: "user_status_changed"; username: string; status: PresenceStatus }
  | { type: "user_disconnected"; username: string }
  | {
    type: "new_message";
    id: string;
    channel_id: string;
    author_id: string;
    author_username: string;
    content: string;
    created_at: string;
    edited_at?: string | null;
    attachments?: MessageAttachment[];
  }
  | {
    type: "message_edited";
    id: string;
    channel_id: string;
    content: string;
    edited_at: string;
  }
  | { type: "message_deleted"; id: string; channel_id: string }
  | { type: "channel_created"; channel: Channel }
  | { type: "channel_deleted"; id: string }
  | { type: "channel_activity"; channel_id: string }
  | { type: "typing_start"; channel_id: string; username: string }
  | { type: "typing_stop"; channel_id: string; username: string }
  | {
    type: "voice_presence_snapshot";
    channels: { channel_id: string; usernames: string[] }[];
  }
  | { type: "voice_joined"; channel_id: string; user_id: string }
  | { type: "voice_left"; channel_id: string; user_id: string }
  | { type: "voice_user_joined"; channel_id: string; username: string }
  | { type: "voice_user_left"; channel_id: string; username: string }
  | { type: "voice_user_speaking"; channel_id: string; username: string; speaking: boolean }
  | { type: "media_signal"; channel_id: string; payload: unknown };

export type WsConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

export interface WsConnectionStatusSnapshot {
  status: WsConnectionStatus;
  reconnectAttempts: number;
  reconnectDelayMs: number;
}

type MessageHandler = (msg: ServerMessage) => void;
type CloseHandler = () => void;
type StatusHandler = (snapshot: WsConnectionStatusSnapshot) => void;

const WS_HEARTBEAT_INTERVAL_MS = 15000;
const WS_RECONNECT_DELAY_MS = 1000;
const WS_MAX_RECONNECT_ATTEMPTS = 10;
const PRESENCE_ACTIVITY_THROTTLE_MS = 5000;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let closeHandlers: CloseHandler[] = [];
let statusHandlers: StatusHandler[] = [];
let pendingSends: string[] = [];
let latestPresenceUsers: PresenceUser[] | null = null;
let latestVoicePresenceChannels: { channel_id: string; usernames: string[] }[] | null = null;
let manualDisconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let lastConnectUrl: string | null = null;
let connectionStatus: WsConnectionStatus = "disconnected";
let lastPresenceActivitySentAt = 0;
let presenceActivityListenersAttached = false;

const AUTH_FAILURE_MESSAGES = new Set([
  "Invalid token",
  "User not found",
  "Must authenticate first",
  "Username already connected",
  "You were logged out because this account connected from another session",
]);
const AUTH_NOTICE_STORAGE_KEY = "yankcord_auth_notice";
const SESSION_REPLACED_MESSAGE = "You were logged out because this account connected from another session";

function shouldForceLogout(message: string): boolean {
  return AUTH_FAILURE_MESSAGES.has(message);
}

function notifyStatus() {
  const snapshot: WsConnectionStatusSnapshot = {
    status: connectionStatus,
    reconnectAttempts,
    reconnectDelayMs: WS_RECONNECT_DELAY_MS,
  };

  statusHandlers.forEach((handler) => handler(snapshot));
}

function setConnectionStatus(nextStatus: WsConnectionStatus) {
  const changed = connectionStatus !== nextStatus;
  connectionStatus = nextStatus;

  if (changed) {
    notifyStatus();
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(ws: WebSocket) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }

    ws.send(JSON.stringify({ type: "heartbeat" }));
  }, WS_HEARTBEAT_INTERVAL_MS);
}

function sendPresenceActivitySignal() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }

  const now = Date.now();
  if (now - lastPresenceActivitySentAt < PRESENCE_ACTIVITY_THROTTLE_MS) {
    return;
  }

  lastPresenceActivitySentAt = now;
  send({ type: "presence_activity" });
}

function attachPresenceActivityListeners() {
  if (presenceActivityListenersAttached || typeof window === "undefined") {
    return;
  }

  presenceActivityListenersAttached = true;

  window.addEventListener("focus", () => {
    sendPresenceActivitySignal();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      sendPresenceActivitySignal();
    }
  });

  const interactionEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "mousedown", "touchstart"];
  interactionEvents.forEach((eventName) => {
    window.addEventListener(eventName, () => {
      sendPresenceActivitySignal();
    }, { passive: true });
  });
}

export function connect(url = getWsUrl(), reconnectAttempt = false) {
  attachPresenceActivityListeners();

  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  if (!reconnectAttempt) {
    reconnectAttempts = 0;
    setConnectionStatus("connecting");
  } else {
    setConnectionStatus("reconnecting");
  }

  lastConnectUrl = url;
  manualDisconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) {
      return;
    }

    reconnectAttempts = 0;
    setConnectionStatus("connected");
    startHeartbeat(ws);

    const t = token();
    if (t) {
      ws.send(JSON.stringify({ type: "authenticate", token: t }));
    }

    while (pendingSends.length > 0) {
      const payload = pendingSends.shift();
      if (payload) {
        ws.send(payload);
      }
    }
  };

  ws.onmessage = (ev) => {
    try {
      const msg: ServerMessage = JSON.parse(ev.data);

      if (msg.type === "error" && shouldForceLogout(msg.message)) {
        if (msg.message === SESSION_REPLACED_MESSAGE) {
          sessionStorage.setItem(
            AUTH_NOTICE_STORAGE_KEY,
            "You were signed out because this account connected in another window or tab.",
          );
        }
        disconnect();
        clearAuthSession();
        window.location.assign("/login");
        return;
      }

      if (msg.type === "presence_snapshot") {
        if ("users" in msg && Array.isArray(msg.users)) {
          latestPresenceUsers = msg.users.map((user) => ({
            username: user.username,
            status: user.status,
          }));
        } else if ("usernames" in msg && Array.isArray(msg.usernames)) {
          latestPresenceUsers = msg.usernames.map((username) => ({
            username,
            status: "online",
          }));
        }
      } else if (msg.type === "voice_presence_snapshot") {
        latestVoicePresenceChannels = msg.channels.map((channel) => ({
          channel_id: channel.channel_id,
          usernames: [...new Set(channel.usernames)].sort((a, b) => a.localeCompare(b)),
        }));
      } else if (msg.type === "user_connected") {
        const current = latestPresenceUsers ?? [];
        const usersByUsername = new Map(current.map((user) => [user.username, user]));
        usersByUsername.set(msg.username, {
          username: msg.username,
          status: msg.status ?? "online",
        });
        latestPresenceUsers = Array.from(usersByUsername.values());
      } else if (msg.type === "user_status_changed") {
        const current = latestPresenceUsers ?? [];
        const usersByUsername = new Map(current.map((user) => [user.username, user]));
        usersByUsername.set(msg.username, { username: msg.username, status: msg.status });
        latestPresenceUsers = Array.from(usersByUsername.values());
      } else if (msg.type === "user_disconnected") {
        latestPresenceUsers = latestPresenceUsers
          ? latestPresenceUsers.filter((user) => user.username !== msg.username)
          : [];
      } else if (msg.type === "voice_user_joined") {
        const current = latestVoicePresenceChannels ?? [];
        const channelsById = new Map(current.map((channel) => [channel.channel_id, [...channel.usernames]]));
        const nextUsers = channelsById.get(msg.channel_id) ?? [];
        channelsById.set(msg.channel_id, [...new Set([...nextUsers, msg.username])].sort((a, b) => a.localeCompare(b)));
        latestVoicePresenceChannels = Array.from(channelsById.entries()).map(([channel_id, usernames]) => ({ channel_id, usernames }));
      } else if (msg.type === "voice_user_left") {
        const current = latestVoicePresenceChannels ?? [];
        const channelsById = new Map(current.map((channel) => [channel.channel_id, [...channel.usernames]]));
        const nextUsers = (channelsById.get(msg.channel_id) ?? []).filter((username) => username !== msg.username);

        if (nextUsers.length === 0) {
          channelsById.delete(msg.channel_id);
        } else {
          channelsById.set(msg.channel_id, nextUsers);
        }

        latestVoicePresenceChannels = Array.from(channelsById.entries()).map(([channel_id, usernames]) => ({ channel_id, usernames }));
      }

      handlers.forEach((h) => h(msg));
    } catch {
      console.error("Failed to parse WS message:", ev.data);
    }
  };

  ws.onclose = () => {
    stopHeartbeat();

    if (socket === ws) {
      socket = null;
    }

    closeHandlers.forEach((handler) => handler());

    if (!manualDisconnect && token() && !reconnectTimer) {
      reconnectAttempts += 1;
      if (reconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus("failed");
        return;
      }

      setConnectionStatus("reconnecting");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(lastConnectUrl ?? getWsUrl(), true);
      }, WS_RECONNECT_DELAY_MS);
      return;
    }

    setConnectionStatus("disconnected");
  };
}

export function disconnect() {
  manualDisconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  socket?.close();
  socket = null;
  reconnectAttempts = 0;
  setConnectionStatus("disconnected");
  pendingSends = [];
  latestPresenceUsers = null;
  latestVoicePresenceChannels = null;
}

export function send(data: unknown) {
  const payload = JSON.stringify(data);
  if (!socket) {
    pendingSends.push(payload);
    connect();
    return;
  }

  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(payload);
    return;
  }

  if (socket?.readyState === WebSocket.CONNECTING) {
    pendingSends.push(payload);
  }
}

export function onMessage(handler: MessageHandler) {
  handlers.push(handler);

  if (latestPresenceUsers) {
    handler({
      type: "presence_snapshot",
      users: latestPresenceUsers.map((user) => ({
        username: user.username,
        status: user.status,
      })),
    });
  }

  if (latestVoicePresenceChannels) {
    handler({
      type: "voice_presence_snapshot",
      channels: latestVoicePresenceChannels.map((channel) => ({
        channel_id: channel.channel_id,
        usernames: [...channel.usernames],
      })),
    });
  }

  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

export function onClose(handler: CloseHandler) {
  closeHandlers.push(handler);

  return () => {
    closeHandlers = closeHandlers.filter((h) => h !== handler);
  };
}

export function onConnectionStatus(handler: StatusHandler) {
  statusHandlers.push(handler);
  handler({
    status: connectionStatus,
    reconnectAttempts,
    reconnectDelayMs: WS_RECONNECT_DELAY_MS,
  });

  return () => {
    statusHandlers = statusHandlers.filter((h) => h !== handler);
  };
}
