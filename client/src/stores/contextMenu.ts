import { createSignal } from "solid-js";
import type { Channel as ChatChannel } from "./chat";

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  targetType: "channel" | "message" | "member" | null;
  targetId: string | null;
  targetData: unknown;
}

export interface ContextMenuHandlers {
  channel?: {
    onDelete: (channel: ChatChannel) => void;
  };
  message?: {
    onEdit: (message: MessageContextData) => void;
    onDelete: (message: MessageContextData) => void;
  };
  member?: {
    onViewProfile: (member: MemberContextData) => void;
    onSendMessage: (member: MemberContextData) => void;
  };
}

export interface MessageContextData {
  id: string;
  author_username: string;
  content: string;
}

export interface MemberContextData {
  username: string;
}

const [contextMenu, setContextMenu] = createSignal<ContextMenuState>({
  isOpen: false,
  x: 0,
  y: 0,
  targetType: null,
  targetId: null,
  targetData: null,
});

const [contextMenuHandlers, setContextMenuHandlers] = createSignal<ContextMenuHandlers>({});

export function registerContextMenuHandlers(handlers: Partial<ContextMenuHandlers>) {
  setContextMenuHandlers((current) => ({
    channel: handlers.channel ?? current.channel,
    message: handlers.message ?? current.message,
    member: handlers.member ?? current.member,
  }));
}

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
const LONG_PRESS_DURATION = 500;

let lastFocusedElement: HTMLElement | null = null;
let lastTargetType: ContextMenuState["targetType"] | null = null;
let lastTargetId: string | null = null;
let lastTargetData: unknown = null;

export function setContextMenuTarget(type: ContextMenuState["targetType"], id: string, data?: unknown) {
  lastTargetType = type;
  lastTargetId = id;
  lastTargetData = data ?? null;
  lastFocusedElement = document.activeElement as HTMLElement;
}

export function openContextMenuAtFocused(
  x: number,
  y: number,
) {
  if (lastTargetType && lastTargetId) {
    openContextMenu(x, y, lastTargetType, lastTargetId, lastTargetData);
  }
}

export function handleContextMenuKeyDown(e: KeyboardEvent) {
  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    openContextMenuAtFocused(rect.left, rect.top);
  }
}

function restoreFocus() {
  if (lastFocusedElement) {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}

export function handleLongPressStart(
  x: number,
  y: number,
  targetType: ContextMenuState["targetType"],
  targetId: string,
  targetData?: unknown,
) {
  longPressTimer = setTimeout(() => {
    openContextMenu(x, y, targetType, targetId, targetData);
    longPressTimer = null;
  }, LONG_PRESS_DURATION);
}

export function handleLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

export function openContextMenu(
  x: number,
  y: number,
  targetType: ContextMenuState["targetType"],
  targetId: string,
  targetData?: unknown,
) {
  handleLongPressEnd();
  setContextMenu({
    isOpen: true,
    x,
    y,
    targetType,
    targetId,
    targetData: targetData ?? null,
  });
}

export function closeContextMenu() {
  handleLongPressEnd();
  restoreFocus();
  setContextMenu((current) => ({
    ...current,
    isOpen: false,
  }));
}

export { contextMenu, contextMenuHandlers };
