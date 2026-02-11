import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { post } from "../api/http";
import { saveAuth } from "../stores/auth";

interface AuthResponse {
  token: string;
  user_id: string;
  username: string;
}

export default function Register() {
  const navigate = useNavigate();
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");
    try {
      const res = await post<AuthResponse>("/register", {
        username: username(),
        password: password(),
      });
      saveAuth(res.token, res.user_id, res.username);
      navigate("/servers/browse");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  }

  return (
    <div class="auth-page">
      <form class="auth-form" onSubmit={handleSubmit}>
        <h1>Register</h1>
        {error() && <p class="error">{error()}</p>}
        <input
          type="text"
          placeholder="Username"
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <button type="submit">Register</button>
        <p>
          Already have an account?{" "}
          <a href="/login">Login</a>
        </p>
      </form>
    </div>
  );
}
