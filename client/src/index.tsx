/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ServerView from "./pages/ServerView";
import "./styles/global.css";

render(
  () => (
    <Router root={App}>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/servers/:serverId" component={ServerView} />
      <Route path="/" component={Login} />
    </Router>
  ),
  document.getElementById("root") as HTMLElement,
);
