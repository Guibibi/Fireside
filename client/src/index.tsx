/* @refresh reload */
import { render } from "solid-js/web";
import { Navigate, Route, Router } from "@solidjs/router";
import { createResource } from "solid-js";
import App from "./App";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Register from "./pages/Register";
import Chat from "./pages/Chat";
import { isAuthenticated, normalizeServerUrl, serverUrl } from "./stores/auth";
import "./styles/global.css";

function shouldAllowNativeContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return !!target.closest("input, textarea, [contenteditable='true']");
}

document.addEventListener("contextmenu", (event) => {
  if (shouldAllowNativeContextMenu(event.target)) {
    return;
  }

  event.preventDefault();
});

async function checkSetupStatus(): Promise<boolean> {
  try {
    const base = normalizeServerUrl(serverUrl());
    const response = await fetch(`${base}/api/setup-status`);
    if (!response.ok) return false;
    const data = (await response.json()) as { needs_setup: boolean };
    return data.needs_setup;
  } catch {
    return false;
  }
}

function RootRoute() {
  if (isAuthenticated()) {
    return <Navigate href="/chat" />;
  }

  const [needsSetup] = createResource(checkSetupStatus);

  return (
    <>
      {needsSetup.loading && <div class="auth-page" />}
      {!needsSetup.loading && (
        <Navigate href={needsSetup() ? "/setup" : "/login"} />
      )}
    </>
  );
}

function LoginRoute() {
  if (isAuthenticated()) {
    return <Navigate href="/chat" />;
  }

  return <Login />;
}

function SetupRoute() {
  if (isAuthenticated()) {
    return <Navigate href="/chat" />;
  }

  return <Setup />;
}

function RegisterRoute() {
  if (isAuthenticated()) {
    return <Navigate href="/chat" />;
  }

  return <Register />;
}

function ChatRoute() {
  if (!isAuthenticated()) {
    return <Navigate href="/login" />;
  }

  return <Chat />;
}

render(
  () => (
    <Router root={App}>
      <Route path="/login" component={LoginRoute} />
      <Route path="/setup" component={SetupRoute} />
      <Route path="/invite/:code?" component={RegisterRoute} />
      <Route path="/chat" component={ChatRoute} />
      <Route path="/" component={RootRoute} />
    </Router>
  ),
  document.getElementById("root") as HTMLElement,
);
