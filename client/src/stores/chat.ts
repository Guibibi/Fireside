import { createSignal } from "solid-js";

export interface Channel {
  id: string;
  name: string;
  kind: "text" | "voice";
  position: number;
  created_at: string;
}

const [activeChannelId, setActiveChannelId] = createSignal<string | null>(null);

export function resetChatState() {
  setActiveChannelId(null);
}

export { activeChannelId, setActiveChannelId };
