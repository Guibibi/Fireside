import { getWsUrl, token } from "../stores/auth";
import type { Channel } from "../stores/chat";

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
    edited_at?: string | null;
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
  | { type: "media_signal"; channel_id: string; payload: unknown };

type MessageHandler = (msg: ServerMessage) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let pendingSends: string[] = [];
let latestPresenceUsernames: string[] | null = null;
let latestVoicePresenceChannels: { channel_id: string; usernames: string[] }[] | null = null;

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
      } else if (msg.type === "voice_presence_snapshot") {
        latestVoicePresenceChannels = msg.channels.map((channel) => ({
          channel_id: channel.channel_id,
          usernames: [...new Set(channel.usernames)].sort((a, b) => a.localeCompare(b)),
        }));
      } else if (msg.type === "user_connected") {
        latestPresenceUsernames = latestPresenceUsernames
          ? [...new Set([...latestPresenceUsernames, msg.username])]
          : [msg.username];
      } else if (msg.type === "user_disconnected") {
        latestPresenceUsernames = latestPresenceUsernames
          ? latestPresenceUsernames.filter((username) => username !== msg.username)
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

  socket.onclose = () => {
    socket = null;
  };
}

export function disconnect() {
  socket?.close();
  socket = null;
  pendingSends = [];
  latestPresenceUsernames = null;
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

  if (latestPresenceUsernames) {
    handler({
      type: "presence_snapshot",
      usernames: [...latestPresenceUsernames],
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
