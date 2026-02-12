import ChannelList from "../components/ChannelList";
import MessageArea from "../components/MessageArea";
import MemberList from "../components/MemberList";
import VoicePanel from "../components/VoicePanel";
import { cleanupMediaTransports } from "../api/media";
import { useNavigate } from "@solidjs/router";
import { clearAuth } from "../stores/auth";
import { resetChatState } from "../stores/chat";
import { resetVoiceState } from "../stores/voice";
import { disconnect } from "../api/ws";

export default function Chat() {
  const navigate = useNavigate();

  function handleLogout() {
    cleanupMediaTransports();
    disconnect();
    resetChatState();
    resetVoiceState();
    clearAuth();
    navigate("/connect");
  }

  return (
    <div class="chat-view">
      <ChannelList />
      <div class="main-content">
        <div class="chat-actions">
          <button type="button" onClick={handleLogout}>Logout</button>
        </div>
        <MessageArea />
        <VoicePanel />
      </div>
      <MemberList />
    </div>
  );
}
