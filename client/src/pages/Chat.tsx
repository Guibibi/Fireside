import { onMount, onCleanup } from "solid-js";
import ChannelList from "../components/ChannelList";
import MessageArea from "../components/MessageArea";
import MemberList from "../components/MemberList";
import ContextMenuContainer from "../components/ContextMenuContainer";
import { handleContextMenuKeyDown } from "../stores/contextMenu";

export default function Chat() {
  onMount(() => {
    document.addEventListener("keydown", handleContextMenuKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleContextMenuKeyDown);
  });

  return (
    <div class="chat-view">
      <ChannelList />
      <div class="main-content">
        <MessageArea />
      </div>
      <MemberList />
      <ContextMenuContainer />
    </div>
  );
}
