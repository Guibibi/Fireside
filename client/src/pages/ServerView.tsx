import { useParams } from "@solidjs/router";
import Sidebar from "../components/Sidebar";
import ChannelList from "../components/ChannelList";
import MessageArea from "../components/MessageArea";
import MemberList from "../components/MemberList";
import VoicePanel from "../components/VoicePanel";

export default function ServerView() {
  const params = useParams<{ serverId: string }>();

  return (
    <div class="server-view">
      <Sidebar />
      <ChannelList serverId={params.serverId} />
      <div class="main-content">
        <MessageArea />
        <VoicePanel />
      </div>
      <MemberList serverId={params.serverId} />
    </div>
  );
}
