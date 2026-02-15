import { createSignal } from "solid-js";

const [token, setToken] = createSignal<string | null>(
  localStorage.getItem("yankcord_token"),
);

const [username, setUsername] = createSignal<string | null>(
  localStorage.getItem("yankcord_username"),
);

const [serverUrl, setServerUrl] = createSignal<string>(
  normalizeServerUrl(localStorage.getItem("yankcord_server_url") || defaultServerUrl()),
);

function defaultServerUrl(): string {
  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }

  const { protocol, hostname } = window.location;
  if (protocol === "http:" || protocol === "https:") {
    return `${protocol}//${hostname}`;
  }

  return "http://localhost:3000";
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  let withProtocol: string;
  if (/^https?:\/\//i.test(trimmed)) {
    withProtocol = trimmed;
  } else if (/^localhost(:|$)/i.test(trimmed) || /^127\./.test(trimmed)) {
    withProtocol = `http://${trimmed}`;
  } else {
    withProtocol = `https://${trimmed}`;
  }
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

export function clearAuthSession() {
  localStorage.removeItem("yankcord_token");
  localStorage.removeItem("yankcord_username");
  setToken(null);
  setUsername(null);
}

export function clearAuth() {
  clearAuthSession();
  localStorage.removeItem("yankcord_server_url");
  setServerUrl(defaultServerUrl());
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
