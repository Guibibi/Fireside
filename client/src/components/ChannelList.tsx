interface Props {
  serverId: string;
}

export default function ChannelList(props: Props) {
  return (
    <div class="channel-list">
      <h3>Channels</h3>
      <p class="placeholder">Server: {props.serverId}</p>
      {/* TODO: fetch and display channels */}
    </div>
  );
}
