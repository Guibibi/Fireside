import { createSignal } from "solid-js";

const [profileModalUsername, setProfileModalUsername] = createSignal<string | null>(null);

export { profileModalUsername };

export function openProfileModal(username: string) {
  setProfileModalUsername(username);
}

export function closeProfileModal() {
  setProfileModalUsername(null);
}
