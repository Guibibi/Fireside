import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowTitlebar() {
  function handleMinimize() {
    void getCurrentWindow().minimize();
  }

  function handleToggleMaximize() {
    void getCurrentWindow().toggleMaximize();
  }

  function handleClose() {
    void getCurrentWindow().close();
  }

  return (
    <header class="window-titlebar" aria-label="Window title bar">
      <div
        class="window-titlebar-drag-region"
        data-tauri-drag-region
        onDblClick={handleToggleMaximize}
      >
        <span class="window-titlebar-dot" aria-hidden="true" />
        <span class="window-titlebar-title">Yankcord</span>
      </div>
      <div class="window-titlebar-controls" aria-label="Window controls">
        <button
          type="button"
          class="window-titlebar-button"
          aria-label="Minimize window"
          onClick={handleMinimize}
        >
          <span class="window-titlebar-icon window-titlebar-icon-minimize" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="window-titlebar-button"
          aria-label="Maximize or restore window"
          onClick={handleToggleMaximize}
        >
          <span class="window-titlebar-icon window-titlebar-icon-maximize" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="window-titlebar-button window-titlebar-button-close"
          aria-label="Close window"
          onClick={handleClose}
        >
          <span class="window-titlebar-icon window-titlebar-icon-close" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
