import { isTauriRuntime } from "../utils/platform";

interface PluginUpdaterResult {
  available: boolean;
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

export interface AvailableAppUpdate {
  version: string;
  currentVersion: string;
  publishedAt: string | null;
  changelog: string;
  downloadAndInstall: () => Promise<void>;
}

function isPluginUpdaterResult(value: unknown): value is PluginUpdaterResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.available === "boolean"
    && typeof candidate.version === "string"
    && typeof candidate.currentVersion === "string"
    && typeof candidate.downloadAndInstall === "function";
}

export async function checkForAppUpdate(): Promise<AvailableAppUpdate | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { check } = await import("@tauri-apps/plugin-updater");
  const result = await check();

  if (!isPluginUpdaterResult(result) || !result.available) {
    return null;
  }

  return {
    version: result.version,
    currentVersion: result.currentVersion,
    publishedAt: typeof result.date === "string" ? result.date : null,
    changelog: typeof result.body === "string" ? result.body : "",
    downloadAndInstall: result.downloadAndInstall,
  };
}

export async function getCurrentAppVersion(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
