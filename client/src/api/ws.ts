import { getWsUrl, token } from "../stores/auth";

export type ServerMessage =
  | { type: "authenticated"; user_id: string; username: string }
  | { type: "error"; message: string }
  | { type: "new_message"; id: string; channel_id: string; author_id: string; content: string; created_at: string }
  | { type: "voice_joined"; channel_id: string; user_id: string }
  | { type: "voice_left"; channel_id: string; user_id: string }
  | { type: "media_signal"; channel_id: string; payload: unknown };

type MessageHandler = (msg: ServerMessage) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];

export function connect(url = getWsUrl()) {
  if (socket?.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(url);

  socket.onopen = () => {
    const t = token();
    if (t) {
      send({ type: "authenticate", token: t });
    }
  };

  socket.onmessage = (ev) => {
    try {
      const msg: ServerMessage = JSON.parse(ev.data);
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
}

export function send(data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

export function onMessage(handler: MessageHandler) {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}
