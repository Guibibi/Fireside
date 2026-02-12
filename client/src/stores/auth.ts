import { createSignal } from "solid-js";

const [token, setToken] = createSignal<string | null>(
  localStorage.getItem("yankcord_token"),
);

const [username, setUsername] = createSignal<string | null>(
  localStorage.getItem("yankcord_username"),
);

const [serverUrl, setServerUrl] = createSignal<string>(
  normalizeServerUrl(
    localStorage.getItem("yankcord_server_url") || "http://localhost:3000",
  ),
);

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withProtocol.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
}

export { token, username, serverUrl };

export function saveAuth(t: string, uname: string, url: string) {
  const normalizedUrl = normalizeServerUrl(url);
  localStorage.setItem("yankcord_token", t);
  localStorage.setItem("yankcord_username", uname);
  localStorage.setItem("yankcord_server_url", normalizedUrl);
  setToken(t);
  setUsername(uname);
  setServerUrl(normalizedUrl);
}

export function updateAuthIdentity(t: string, uname: string) {
  localStorage.setItem("yankcord_token", t);
  localStorage.setItem("yankcord_username", uname);
  setToken(t);
  setUsername(uname);
}

export function clearAuth() {
  localStorage.removeItem("yankcord_token");
  localStorage.removeItem("yankcord_username");
  localStorage.removeItem("yankcord_server_url");
  setToken(null);
  setUsername(null);
  setServerUrl("http://localhost:3000");
}

export function isAuthenticated(): boolean {
  return token() !== null && serverUrl().length > 0;
}

export function getApiBaseUrl(): string {
  return `${serverUrl()}/api`;
}

export function getWsUrl(): string {
  const base = serverUrl();
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}/ws`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}/ws`;
  }
  return `ws://${base}/ws`;
}
