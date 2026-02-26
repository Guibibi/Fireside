import { Show, createSignal } from "solid-js";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { contextMenu, closeContextMenu, contextMenuHandlers, type MessageContextData, type MemberContextData } from "../stores/contextMenu";
import { username } from "../stores/auth";
import { clampUserVolume, getUserVolume, setUserVolume } from "../stores/userVolume";
import { updateUserGainNodes } from "../api/media/consumers";
import { participantsInChannel, joinedVoiceChannelId } from "../stores/voice";
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
      const onEdit = handlers.channel?.onEdit;
      const onDelete = handlers.channel?.onDelete;

      if (onEdit) {
        items.push({
          label: "Edit Channel",
          onClick: () => onEdit(channelData),
          dividerAfter: true,
        });
      }

      if (onDelete) {
        items.push({
          label: "Delete Channel",
          onClick: () => onDelete(channelData),
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

      const voiceChannelId = joinedVoiceChannelId();
      if (
        voiceChannelId &&
        memberData.username !== username() &&
        participantsInChannel(voiceChannelId).includes(memberData.username)
      ) {
        items.push({
          kind: "custom",
          render: () => <VolumeSlider username={memberData.username} />,
          dividerAfter: false,
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

function VolumeSlider(props: { username: string }) {
  const [localVolume, setLocalVolume] = createSignal(getUserVolume(props.username));

  function handleInput(e: InputEvent) {
    const value = clampUserVolume(parseInt((e.target as HTMLInputElement).value, 10));
    setLocalVolume(value);
    setUserVolume(props.username, value);
    updateUserGainNodes(props.username, value);
  }

  function handleReset() {
    setLocalVolume(100);
    setUserVolume(props.username, 100);
    updateUserGainNodes(props.username, 100);
  }

  return (
    <div class="context-menu-volume" onMouseDown={(e) => e.stopPropagation()}>
      <div class="context-menu-volume-header">
        <span class="context-menu-volume-label">User Volume</span>
        <span class="context-menu-volume-value">{localVolume()}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={localVolume()}
        onInput={handleInput}
        class="context-menu-volume-slider"
      />
      <Show when={localVolume() !== 100}>
        <button
          type="button"
          class="context-menu-item context-menu-volume-reset"
          onClick={handleReset}
        >
          Reset to 100%
        </button>
      </Show>
    </div>
  );
}
