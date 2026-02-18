import { createSignal } from "solid-js";
import { checkForAppUpdate, type AvailableAppUpdate } from "../api/updater";
import { errorMessage } from "../utils/error";
import { isTauriRuntime } from "../utils/platform";

const UPDATE_POLL_INTERVAL_MS = 10 * 60 * 1000;

const [availableAppUpdate, setAvailableAppUpdate] = createSignal<AvailableAppUpdate | null>(null);
const [isCheckingForUpdate, setIsCheckingForUpdate] = createSignal(false);
const [isInstallingUpdate, setIsInstallingUpdate] = createSignal(false);
const [updaterStatusMessage, setUpdaterStatusMessage] = createSignal("");
const [updaterErrorMessage, setUpdaterErrorMessage] = createSignal("");

let pollingIntervalId: ReturnType<typeof setInterval> | null = null;
let pollingConsumers = 0;

export {
  availableAppUpdate,
  isCheckingForUpdate,
  isInstallingUpdate,
  updaterStatusMessage,
  updaterErrorMessage,
};

export function hasPendingAppUpdate() {
  return availableAppUpdate() !== null;
}

export async function checkForUpdates(showUpToDateMessage: boolean): Promise<void> {
  if (!isTauriRuntime() || isCheckingForUpdate()) {
    return;
  }

  setIsCheckingForUpdate(true);
  setUpdaterErrorMessage("");
  try {
    const update = await checkForAppUpdate();
    setAvailableAppUpdate(update);

    if (update) {
      setUpdaterStatusMessage(`Version ${update.version} is available.`);
    } else if (showUpToDateMessage) {
      setUpdaterStatusMessage("You are already on the latest version.");
    } else {
      setUpdaterStatusMessage("");
    }
  } catch (error) {
    setUpdaterErrorMessage(errorMessage(error, "Unable to check for updates"));
  } finally {
    setIsCheckingForUpdate(false);
  }
}

export async function installAvailableUpdate(): Promise<void> {
  const update = availableAppUpdate();
  if (!update || isInstallingUpdate()) {
    return;
  }

  setIsInstallingUpdate(true);
  setUpdaterErrorMessage("");
  try {
    await update.downloadAndInstall();
    setUpdaterStatusMessage("Update downloaded. Restart Yankcord to finish installing.");
    setAvailableAppUpdate(null);
  } catch (error) {
    setUpdaterErrorMessage(errorMessage(error, "Failed to download and install update"));
  } finally {
    setIsInstallingUpdate(false);
  }
}

export function startUpdaterPolling() {
  if (!isTauriRuntime()) {
    return () => {
      // no-op in web runtime
    };
  }

  pollingConsumers += 1;
  if (pollingConsumers === 1) {
    void checkForUpdates(false);
    pollingIntervalId = setInterval(() => {
      void checkForUpdates(false);
    }, UPDATE_POLL_INTERVAL_MS);
  }

  return () => {
    pollingConsumers = Math.max(0, pollingConsumers - 1);
    if (pollingConsumers === 0 && pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  };
}
