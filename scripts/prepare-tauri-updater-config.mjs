import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoSlug = process.env.GITHUB_REPOSITORY;
const defaultEndpoint = repoSlug
  ? `https://github.com/${repoSlug}/releases/latest/download/latest.json`
  : "";

const pubkey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim() ?? "";
const endpoint = process.env.TAURI_UPDATER_ENDPOINT?.trim() || defaultEndpoint;

if (!pubkey) {
  throw new Error("TAURI_UPDATER_PUBLIC_KEY is required");
}

if (!endpoint) {
  throw new Error("TAURI_UPDATER_ENDPOINT is required");
}

const configPath = path.resolve("client", "src-tauri", "tauri.conf.json");
const configText = await readFile(configPath, "utf8");
const config = JSON.parse(configText);

config.bundle = {
  ...config.bundle,
  createUpdaterArtifacts: true,
};

config.plugins = {
  ...config.plugins,
  updater: {
    ...(config.plugins?.updater ?? {}),
    pubkey,
    endpoints: [endpoint],
  },
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
