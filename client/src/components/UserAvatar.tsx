import { Show, createEffect, createSignal } from "solid-js";
import { avatarUrlFor, displayNameFor } from "../stores/userProfiles";

interface UserAvatarProps {
  username: string;
  class?: string;
  size?: number;
}

function initialFor(usernameValue: string): string {
  const trimmed = usernameValue.trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed.slice(0, 1).toUpperCase();
}

export default function UserAvatar(props: UserAvatarProps) {
  const [broken, setBroken] = createSignal(false);

  const classes = () => `user-avatar${props.class ? ` ${props.class}` : ""}`;
  const avatarUrl = () => avatarUrlFor(props.username);
  const displayName = () => displayNameFor(props.username);
  const shouldShowImage = () => !!avatarUrl() && !broken();

  createEffect(() => {
    avatarUrl();
    setBroken(false);
  });

  return (
    <span
      class={classes()}
      style={props.size ? { "--avatar-size": `${props.size}px` } : undefined}
      aria-label={`${displayName()} avatar`}
      role="img"
    >
      <Show when={shouldShowImage()} fallback={<span>{initialFor(displayName())}</span>}>
        <img src={avatarUrl() ?? ""} alt="" onError={() => setBroken(true)} />
      </Show>
    </span>
  );
}
