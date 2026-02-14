import ChannelList from "../components/ChannelList";
import MessageArea from "../components/MessageArea";
import MemberList from "../components/MemberList";

export default function Chat() {
  return (
    <div class="chat-view">
      <ChannelList />
      <div class="main-content">
        <MessageArea />
      </div>
      <MemberList />
    </div>
  );
}
