import { Show, createSignal, onMount } from "solid-js";
import { checkForAppUpdate, type AvailableAppUpdate } from "../../api/updater";
import { errorMessage } from "../../utils/error";
import { isTauriRuntime } from "../../utils/platform";
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
  const [availableUpdate, setAvailableUpdate] = createSignal<AvailableAppUpdate | null>(null);
  const [isChecking, setIsChecking] = createSignal(false);
  const [isInstalling, setIsInstalling] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal("");
  const [updateError, setUpdateError] = createSignal("");
  const tauriRuntime = isTauriRuntime();

  async function checkForUpdates(showUpToDateMessage: boolean) {
    if (!tauriRuntime || isChecking()) {
      return;
    }

    setIsChecking(true);
    setUpdateError("");
    try {
      const update = await checkForAppUpdate();
      setAvailableUpdate(update);
      if (update) {
        setStatusMessage(`Version ${update.version} is available.`);
      } else if (showUpToDateMessage) {
        setStatusMessage("You are already on the latest version.");
      } else {
        setStatusMessage("");
      }
    } catch (error) {
      setUpdateError(errorMessage(error, "Unable to check for updates"));
    } finally {
      setIsChecking(false);
    }
  }

  async function installUpdate() {
    const update = availableUpdate();
    if (!update || isInstalling()) {
      return;
    }

    setIsInstalling(true);
    setUpdateError("");
    try {
      await update.downloadAndInstall();
      setStatusMessage("Update downloaded. Restart Yankcord to finish installing.");
      setAvailableUpdate(null);
    } catch (error) {
      setUpdateError(errorMessage(error, "Failed to download and install update"));
    } finally {
      setIsInstalling(false);
    }
  }

  onMount(() => {
    void checkForUpdates(false);
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
        </Show>
      </div>

      <Show when={tauriRuntime}>
        <div class="settings-actions settings-update-actions">
          <button
            type="button"
            class="settings-secondary"
            onClick={() => void checkForUpdates(true)}
            disabled={isChecking() || isInstalling()}
          >
            {isChecking() ? "Checking..." : "Check for updates"}
          </button>
          <button
            type="button"
            class="settings-secondary"
            onClick={() => void installUpdate()}
            disabled={!availableUpdate() || isInstalling() || isChecking()}
          >
            {isInstalling() ? "Installing..." : "Download and install"}
          </button>
        </div>

        <Show when={availableUpdate()}>
          {(update) => (
            <div class="settings-update-release">
              <p class="settings-help settings-update-meta">
                New release <strong>{update().version}</strong> (current {update().currentVersion}) - {formatPublishedAt(update().publishedAt)}
              </p>
              <UpdateChangelog changelog={update().changelog} />
            </div>
          )}
        </Show>

        <Show when={statusMessage()}>
          <p class="settings-help settings-update-status">{statusMessage()}</p>
        </Show>
      </Show>

      <Show when={updateError()}>
        <p class="error">{updateError()}</p>
      </Show>
    </section>
  );
}
