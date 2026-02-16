import { Show, onMount, onCleanup } from "solid-js";
import ChannelList from "../components/ChannelList";
import MessageArea from "../components/MessageArea";
import MemberList from "../components/MemberList";
import SettingsPage from "../components/SettingsPage";
import ContextMenuContainer from "../components/ContextMenuContainer";
import UserProfileModal from "../components/UserProfileModal";
import { handleContextMenuKeyDown } from "../stores/contextMenu";
import { isStreamWatchFocused } from "../stores/voice";
import { settingsOpen } from "../stores/settings";

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
      <Show when={settingsOpen()} fallback={
        <>
          <div class="main-content">
            <MessageArea />
          </div>
          <Show when={!isStreamWatchFocused()}>
            <MemberList />
          </Show>
        </>
      }>
        <SettingsPage />
      </Show>
      <ContextMenuContainer />
      <UserProfileModal />
    </div>
  );
}
