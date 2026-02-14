import type { JSX } from "solid-js";
import type { Channel } from "../../stores/chat";

export interface ChannelRowProps {
  channel: Channel;
  prefix: string;
  isActive: boolean;
  isVoiceConnected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  disabled: boolean;
  badge?: JSX.Element;
  children?: JSX.Element;
}

export default function ChannelRow(props: ChannelRowProps) {
  return (
    <li class="channel-row">
      <div class="channel-row-main">
        <button
          type="button"
          class={`channel-item${props.isActive ? " is-active" : ""}${props.isVoiceConnected ? " is-voice-connected" : ""}`}
          onClick={props.onSelect}
        >
          <span class="channel-prefix">{props.prefix}</span>
          <span class="channel-name">{props.channel.name}</span>
          {props.badge}
        </button>
        <button
          type="button"
          class="channel-delete"
          onClick={props.onDelete}
          disabled={props.disabled}
          title="Delete channel"
        >
          x
        </button>
      </div>
      {props.children}
    </li>
  );
}
