interface Props {
  serverId: string;
}

export default function MemberList(props: Props) {
  return (
    <aside class="member-list">
      <h3>Members</h3>
      <p class="placeholder">Server: {props.serverId}</p>
      {/* TODO: fetch and display members */}
    </aside>
  );
}
