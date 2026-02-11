import type { RouteSectionProps } from "@solidjs/router";

function App(props: RouteSectionProps) {
  return (
    <div class="app-root">
      {props.children}
    </div>
  );
}

export default App;
