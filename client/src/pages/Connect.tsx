import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { normalizeServerUrl, saveAuth, serverUrl } from "../stores/auth";
import { errorMessage } from "../utils/error";

interface ConnectResponse {
  token: string;
  username: string;
}

export default function Connect() {
  const navigate = useNavigate();
  const [url, setUrl] = createSignal(serverUrl());
  const [password, setPassword] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [error, setError] = createSignal("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");

    if (!url().trim() || !password().trim() || !username().trim()) {
      setError("Server URL, password, and username are required");
      return;
    }

    try {
      const response = await fetch(`${normalizeServerUrl(url())}/api/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: password(),
          username: username().trim(),
        }),
      });

      if (!response.ok) {
        const body = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw new Error(body.error || response.statusText);
      }

      const res = (await response.json()) as ConnectResponse;
      saveAuth(res.token, res.username, url());
      navigate("/chat");
    } catch (err) {
      setError(errorMessage(err, "Failed to connect"));
    }
  }

  return (
    <div class="auth-page">
      <form class="auth-form" onSubmit={handleSubmit}>
        <h1>Connect</h1>
        {error() && <p class="error">{error()}</p>}
        <input
          type="text"
          placeholder="Server URL (e.g. http://192.168.1.50:3000)"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
        <input
          type="password"
          placeholder="Server password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <input
          type="text"
          placeholder="Username"
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
        />
        <button type="submit">Connect</button>
      </form>
    </div>
  );
}
