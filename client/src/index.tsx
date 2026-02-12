/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Connect from "./pages/Connect";
import ServerView from "./pages/ServerView";
import "./styles/global.css";

render(
  () => (
    <Router root={App}>
      <Route path="/login" component={Connect} />
      <Route path="/register" component={Connect} />
      <Route path="/connect" component={Connect} />
      <Route path="/servers/:serverId" component={ServerView} />
      <Route path="/" component={Connect} />
    </Router>
  ),
  document.getElementById("root") as HTMLElement,
);
