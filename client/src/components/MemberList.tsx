import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { connect, onMessage } from "../api/ws";

export default function MemberList() {
  const [members, setMembers] = createSignal<string[]>([]);

  onMount(() => {
    connect();

    const unsubscribe = onMessage((msg) => {
      if (msg.type === "presence_snapshot") {
        setMembers([...msg.usernames].sort((a, b) => a.localeCompare(b)));
        return;
      }

      if (msg.type === "user_connected") {
        setMembers((current) => {
          if (current.includes(msg.username)) {
            return current;
          }

          return [...current, msg.username].sort((a, b) => a.localeCompare(b));
        });
        return;
      }

      if (msg.type === "user_disconnected") {
        setMembers((current) => current.filter((member) => member !== msg.username));
      }
    });

    onCleanup(unsubscribe);
  });

  return (
    <aside class="member-list">
      <h3>Members</h3>
      <Show
        when={members().length > 0}
        fallback={<p class="placeholder">No members connected</p>}
      >
        <ul class="member-items">
          <For each={members()}>
            {(member) => <li class="member-item">{member}</li>}
          </For>
        </ul>
      </Show>
    </aside>
  );
}
