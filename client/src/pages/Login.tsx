import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { AuthResponse } from "../api/http";
import { normalizeServerUrl, saveAuth, serverUrl } from "../stores/auth";
import { errorMessage } from "../utils/error";

const AUTH_NOTICE_STORAGE_KEY = "yankcord_auth_notice";

export default function Login() {
  const navigate = useNavigate();
  const [url, setUrl] = createSignal(serverUrl());
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [error, setError] = createSignal("");

  onMount(() => {
    const storedNotice = sessionStorage.getItem(AUTH_NOTICE_STORAGE_KEY);
    if (!storedNotice) {
      return;
    }

    setNotice(storedNotice);
    sessionStorage.removeItem(AUTH_NOTICE_STORAGE_KEY);
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");

    if (!url().trim() || !username().trim() || !password().trim()) {
      setError("Server URL, username, and password are required");
      return;
    }

    try {
      const response = await fetch(`${normalizeServerUrl(url())}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username().trim(),
          password: password(),
        }),
      });

      if (!response.ok) {
        const body = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw new Error(body.error || response.statusText);
      }

      const res = (await response.json()) as AuthResponse;
      saveAuth(res.token, res.user_id, res.username, res.role, url());
      navigate("/chat");
    } catch (err) {
      setError(errorMessage(err, "Failed to log in"));
    }
  }

  return (
    <div class="auth-page">
      <form class="auth-form" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        {notice() && <p class="info">{notice()}</p>}
        {error() && <p class="error">{error()}</p>}
        <input
          type="text"
          placeholder="Server URL (e.g. http://192.168.1.50:3000)"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
        <input
          type="text"
          placeholder="Username"
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <button type="submit">Log in</button>
        <p class="auth-link">
          Have an invite?{" "}
          <a href="/invite/" onClick={(e) => { e.preventDefault(); navigate("/invite/"); }}>
            Create an account
          </a>
        </p>
      </form>
    </div>
  );
}
