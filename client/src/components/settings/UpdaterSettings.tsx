import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { getCurrentAppVersion } from "../../api/updater";
import { isTauriRuntime } from "../../utils/platform";
import {
  availableAppUpdate,
  checkForUpdates,
  installAvailableUpdate,
  isCheckingForUpdate,
  isInstallingUpdate,
  startUpdaterPolling,
  updaterErrorMessage,
  updaterStatusMessage,
} from "../../stores/updater";
import UpdateChangelog from "./UpdateChangelog";

function formatPublishedAt(isoDate: string | null): string {
  if (!isoDate) {
    return "Unknown release date";
  }

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown release date";
  }

  return parsed.toLocaleString();
}

export default function UpdaterSettings() {
  const tauriRuntime = isTauriRuntime();
  const [currentVersion, setCurrentVersion] = createSignal<string | null>(null);

  onMount(() => {
    if (tauriRuntime) {
      void getCurrentAppVersion()
        .then((version) => {
          setCurrentVersion(version);
        })
        .catch(() => {
          setCurrentVersion(null);
        });
    }

    const stopPolling = startUpdaterPolling();
    onCleanup(stopPolling);
  });

  return (
    <section class="settings-section">
      <div class="settings-section-head">
        <h5>App updates</h5>
        <Show
          when={tauriRuntime}
          fallback={<p class="settings-help">Updates are only available in the Tauri desktop build.</p>}
        >
          <p class="settings-help">Yankcord checks for updates and can install a new release in-app.</p>
          <p class="settings-help settings-update-current-version">
            Current version: <strong>{currentVersion() ?? "Unknown"}</strong>
          </p>
        </Show>
      </div>

      <Show when={tauriRuntime}>
        <div class="settings-actions settings-update-actions">
          <button
            type="button"
            class="settings-secondary"
            onClick={() => void checkForUpdates(true)}
            disabled={isCheckingForUpdate() || isInstallingUpdate()}
          >
            {isCheckingForUpdate() ? "Checking..." : "Check for updates"}
          </button>
          <button
            type="button"
            class="settings-secondary"
            onClick={() => void installAvailableUpdate()}
            disabled={!availableAppUpdate() || isInstallingUpdate() || isCheckingForUpdate()}
          >
            {isInstallingUpdate() ? "Installing..." : "Download and install"}
          </button>
        </div>

        <Show when={availableAppUpdate()}>
          {(update) => (
            <div class="settings-update-release">
              <p class="settings-help settings-update-meta">
                New release <strong>{update().version}</strong> (current {update().currentVersion}) - {formatPublishedAt(update().publishedAt)}
              </p>
              <UpdateChangelog changelog={update().changelog} />
            </div>
          )}
        </Show>

        <Show when={updaterStatusMessage()}>
          <p class="settings-help settings-update-status">{updaterStatusMessage()}</p>
        </Show>
      </Show>

      <Show when={updaterErrorMessage()}>
        <p class="error">{updaterErrorMessage()}</p>
      </Show>
    </section>
  );
}
