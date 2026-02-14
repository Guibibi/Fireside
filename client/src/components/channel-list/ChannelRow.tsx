import type { JSX } from "solid-js";
import type { Channel } from "../../stores/chat";
import {
    openContextMenu,
    handleLongPressStart,
    handleLongPressEnd,
    setContextMenuTarget,
} from "../../stores/contextMenu";

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
    function handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        openContextMenu(
            e.clientX,
            e.clientY,
            "channel",
            props.channel.id,
            props.channel,
        );
    }

    function handleFocus() {
        setContextMenuTarget("channel", props.channel.id, props.channel);
    }

    function handleTouchStart(e: TouchEvent) {
        const touch = e.touches[0];
        handleLongPressStart(
            touch.clientX,
            touch.clientY,
            "channel",
            props.channel.id,
            props.channel,
        );
    }

    function handleTouchEnd() {
        handleLongPressEnd();
    }

    return (
        <li class="channel-row">
            <div class="channel-row-main">
                <button
                    type="button"
                    class={`channel-item${props.isActive ? " is-active" : ""}${props.isVoiceConnected ? " is-voice-connected" : ""}`}
                    onClick={props.onSelect}
                    onContextMenu={handleContextMenu}
                    onFocus={handleFocus}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                >
                    <span class="channel-prefix">{props.prefix}</span>
                    <span class="channel-name">{props.channel.name}</span>
                    {props.badge}
                </button>
            </div>
            {props.children}
        </li>
    );
}
