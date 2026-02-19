import type { RouteSectionProps } from "@solidjs/router";
import WindowTitlebar from "./components/WindowTitlebar";
import { isTauriRuntime } from "./utils/platform";

function App(props: RouteSectionProps) {
  const tauriRuntime = isTauriRuntime();

  return (
    <div class={`app-root${tauriRuntime ? " app-root--tauri" : ""}`}>
      {tauriRuntime && <WindowTitlebar />}
      <div class="app-content">
        {props.children}
      </div>
    </div>
  );
}

export default App;
