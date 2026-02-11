import { createSignal } from "solid-js";

const [token, setToken] = createSignal<string | null>(
  localStorage.getItem("yankcord_token"),
);

const [userId, setUserId] = createSignal<string | null>(
  localStorage.getItem("yankcord_user_id"),
);

const [username, setUsername] = createSignal<string | null>(
  localStorage.getItem("yankcord_username"),
);

export { token, userId, username };

export function saveAuth(t: string, uid: string, uname: string) {
  localStorage.setItem("yankcord_token", t);
  localStorage.setItem("yankcord_user_id", uid);
  localStorage.setItem("yankcord_username", uname);
  setToken(t);
  setUserId(uid);
  setUsername(uname);
}

export function clearAuth() {
  localStorage.removeItem("yankcord_token");
  localStorage.removeItem("yankcord_user_id");
  localStorage.removeItem("yankcord_username");
  setToken(null);
  setUserId(null);
  setUsername(null);
}

export function isAuthenticated(): boolean {
  return token() !== null;
}
