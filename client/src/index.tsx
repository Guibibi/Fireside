/* @refresh reload */
import { render } from "solid-js/web";
import { Navigate, Route, Router } from "@solidjs/router";
import App from "./App";
import Connect from "./pages/Connect";
import Chat from "./pages/Chat";
import { isAuthenticated } from "./stores/auth";
import "./styles/global.css";

function ConnectRoute() {
  if (isAuthenticated()) {
    return <Navigate href="/chat" />;
  }

  return <Connect />;
}

function ChatRoute() {
  if (!isAuthenticated()) {
    return <Navigate href="/connect" />;
  }

  return <Chat />;
}

function RootRoute() {
  return <Navigate href={isAuthenticated() ? "/chat" : "/connect"} />;
}

render(
  () => (
    <Router root={App}>
      <Route path="/connect" component={ConnectRoute} />
      <Route path="/chat" component={ChatRoute} />
      <Route path="/" component={RootRoute} />
    </Router>
  ),
  document.getElementById("root") as HTMLElement,
);
