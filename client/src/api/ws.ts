import { getWsUrl, token } from "../stores/auth";

export type ServerMessage =
  | { type: "authenticated"; user_id: string; username: string }
  | { type: "error"; message: string }
  | { type: "presence_snapshot"; usernames: string[] }
  | { type: "user_connected"; username: string }
  | { type: "user_disconnected"; username: string }
  | {
    type: "new_message";
    id: string;
    channel_id: string;
    author_id: string;
    author_username: string;
    content: string;
    created_at: string;
  }
  | { type: "typing_start"; channel_id: string; username: string }
  | { type: "typing_stop"; channel_id: string; username: string }
  | { type: "voice_joined"; channel_id: string; user_id: string }
  | { type: "voice_left"; channel_id: string; user_id: string }
  | { type: "media_signal"; channel_id: string; payload: unknown };

type MessageHandler = (msg: ServerMessage) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let pendingSends: string[] = [];
let latestPresenceUsernames: string[] | null = null;

export function connect(url = getWsUrl()) {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  socket = new WebSocket(url);

  socket.onopen = () => {
    const t = token();
    if (t) {
      socket?.send(JSON.stringify({ type: "authenticate", token: t }));
    }

    while (pendingSends.length > 0) {
      const payload = pendingSends.shift();
      if (payload) {
        socket?.send(payload);
      }
    }
  };

  socket.onmessage = (ev) => {
    try {
      const msg: ServerMessage = JSON.parse(ev.data);

      if (msg.type === "presence_snapshot") {
        latestPresenceUsernames = [...msg.usernames];
      } else if (msg.type === "user_connected") {
        latestPresenceUsernames = latestPresenceUsernames
          ? [...new Set([...latestPresenceUsernames, msg.username])]
          : [msg.username];
      } else if (msg.type === "user_disconnected") {
        latestPresenceUsernames = latestPresenceUsernames
          ? latestPresenceUsernames.filter((username) => username !== msg.username)
          : [];
      }

      handlers.forEach((h) => h(msg));
    } catch {
      console.error("Failed to parse WS message:", ev.data);
    }
  };

  socket.onclose = () => {
    socket = null;
  };
}

export function disconnect() {
  socket?.close();
  socket = null;
  pendingSends = [];
  latestPresenceUsernames = null;
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

  if (latestPresenceUsernames) {
    handler({
      type: "presence_snapshot",
      usernames: [...latestPresenceUsernames],
    });
  }

  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}
