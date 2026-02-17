import { For } from "solid-js";
import { changelogItems } from "../../utils/changelog";

interface UpdateChangelogProps {
  changelog: string;
}

export default function UpdateChangelog(props: UpdateChangelogProps) {
  return (
    <div class="settings-update-changelog">
      <h6>What's new</h6>
      <ul>
        <For each={changelogItems(props.changelog)}>
          {(item) => <li>{item}</li>}
        </For>
      </ul>
    </div>
  );
}
