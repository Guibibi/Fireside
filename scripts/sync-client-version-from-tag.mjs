import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    result[key] = value;
    index += 1;
  }

  return result;
}

function normalizeVersion(tag) {
  const normalized = tag.startsWith("v") ? tag.slice(1) : tag;
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid tag/version '${tag}'. Expected vMAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH.`);
  }
  return normalized;
}

async function updateJsonVersion(filePath, nextVersion) {
  const content = await readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${String(error)}`);
  }
  parsed.version = nextVersion;
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function updateCargoPackageVersion(filePath, nextVersion) {
  const content = await readFile(filePath, "utf8");
  if (!/^version\s*=\s*"[^"]+"/m.test(content)) {
    throw new Error(`Failed to locate package version in ${filePath}`);
  }
  const updated = content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${nextVersion}"`);

  await writeFile(filePath, updated, "utf8");
}

const args = parseArgs(process.argv);
const tag = args.tag ?? process.env.GITHUB_REF_NAME ?? "";

if (!tag) {
  throw new Error("Tag is required. Pass --tag or set GITHUB_REF_NAME.");
}

const version = normalizeVersion(tag);

const tauriConfigPath = path.resolve("client", "src-tauri", "tauri.conf.json");
const tauriCargoPath = path.resolve("client", "src-tauri", "Cargo.toml");
const clientPackagePath = path.resolve("client", "package.json");
const clientPackageLockPath = path.resolve("client", "package-lock.json");

await updateJsonVersion(tauriConfigPath, version);
await updateCargoPackageVersion(tauriCargoPath, version);
await updateJsonVersion(clientPackagePath, version);
await updateJsonVersion(clientPackageLockPath, version);

console.log(`Synchronized client/Tauri versions to ${version}`);
