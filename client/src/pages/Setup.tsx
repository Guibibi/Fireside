import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { AuthResponse } from "../api/http";
import { normalizeServerUrl, saveAuth, serverUrl } from "../stores/auth";
import { errorMessage } from "../utils/error";

export default function Setup() {
  const navigate = useNavigate();
  const [url, setUrl] = createSignal(serverUrl());
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [error, setError] = createSignal("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");

    if (!url().trim() || !username().trim() || !password().trim()) {
      setError("Server URL, username, and password are required");
      return;
    }

    if (password() !== confirmPassword()) {
      setError("Passwords do not match");
      return;
    }

    try {
      const response = await fetch(`${normalizeServerUrl(url())}/api/setup`, {
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
      setError(errorMessage(err, "Failed to create operator account"));
    }
  }

  return (
    <div class="auth-page">
      <form class="auth-form" onSubmit={handleSubmit}>
        <h1>Server Setup</h1>
        <p class="auth-subtitle">Create the first operator account.</p>
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
        <input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword()}
          onInput={(e) => setConfirmPassword(e.currentTarget.value)}
        />
        <button type="submit">Create account</button>
      </form>
    </div>
  );
}
