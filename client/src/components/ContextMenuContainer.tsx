import { Show } from "solid-js";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { contextMenu, closeContextMenu, contextMenuHandlers, type MessageContextData, type MemberContextData } from "../stores/contextMenu";
import { username } from "../stores/auth";
import type { Channel as ChatChannel } from "../stores/chat";

export default function ContextMenuContainer() {
  const menuItems = (): ContextMenuItem[] => {
    const state = contextMenu();
    if (!state.isOpen) {
      return [];
    }

    const handlers = contextMenuHandlers();

    if (state.targetType === "channel") {
      const channelData = state.targetData as ChatChannel;
      const items: ContextMenuItem[] = [];

      if (handlers.channel?.onDelete) {
        items.push({
          label: "Delete Channel",
          onClick: () => handlers.channel!.onDelete(channelData),
          danger: true,
        });
      }

      return items;
    }

    if (state.targetType === "message") {
      const msgData = state.targetData as MessageContextData;
      const isOwnMessage = msgData.author_username === username();
      const items: ContextMenuItem[] = [];

      if (isOwnMessage && handlers.message?.onEdit) {
        items.push({
          label: "Edit Message",
          onClick: () => handlers.message!.onEdit(msgData),
        });
      }
      if (isOwnMessage && handlers.message?.onDelete) {
        items.push({
          label: "Delete Message",
          onClick: () => handlers.message!.onDelete(msgData),
          danger: true,
        });
      }

      items.push({
        label: "Copy Message",
        onClick: () => {
          navigator.clipboard.writeText(msgData.content);
        },
      });

      return items;
    }

    if (state.targetType === "member") {
      const memberData = state.targetData as MemberContextData;
      const items: ContextMenuItem[] = [];

      if (handlers.member?.onViewProfile) {
        items.push({
          label: "View Profile",
          onClick: () => handlers.member!.onViewProfile(memberData),
        });
      }

      if (memberData.username !== username() && handlers.member?.onSendMessage) {
        items.push({
          label: "Send Message",
          onClick: () => handlers.member!.onSendMessage(memberData),
        });
      }

      return items;
    }

    return [];
  };

  return (
    <Show when={contextMenu().isOpen && menuItems().length > 0}>
      <ContextMenu
        items={menuItems()}
        x={contextMenu().x}
        y={contextMenu().y}
        onClose={closeContextMenu}
      />
    </Show>
  );
}
