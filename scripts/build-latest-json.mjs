import { readFile, readdir, writeFile } from "node:fs/promises";
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

async function walkFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function pickCandidate(files, patterns) {
  for (const pattern of patterns) {
    const match = files.find((filePath) => pattern.test(path.basename(filePath)));
    if (match) {
      return match;
    }
  }
  return null;
}

const args = parseArgs(process.argv);
const tag = args.tag ?? process.env.GITHUB_REF_NAME ?? "";
const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? "";
const assetsDir = path.resolve(args["assets-dir"] ?? "release-assets");
const outputPath = path.resolve(args.output ?? path.join(assetsDir, "latest.json"));
const notes = args.notes ?? "See GitHub release notes for full details.";

if (!tag) {
  throw new Error("Tag is required. Pass --tag or set GITHUB_REF_NAME.");
}

if (!repo) {
  throw new Error("Repository slug is required. Pass --repo or set GITHUB_REPOSITORY.");
}

const normalizedVersion = tag.startsWith("v") ? tag.slice(1) : tag;
const allFiles = await walkFiles(assetsDir);
const nonSignatureFiles = allFiles.filter((filePath) => !filePath.endsWith(".sig"));

const platformRules = [
  {
    key: "linux-x86_64",
    patterns: [/\.AppImage$/],
  },
  {
    key: "windows-x86_64",
    patterns: [/-setup\.exe$/i, /\.msi$/i],
  },
  {
    key: "darwin-x86_64",
    patterns: [/\.app\.tar\.gz$/i],
  },
];

const platforms = {};

for (const rule of platformRules) {
  const assetPath = pickCandidate(nonSignatureFiles, rule.patterns);
  if (!assetPath) {
    continue;
  }

  const signaturePath = `${assetPath}.sig`;
  const signature = (await readFile(signaturePath, "utf8")).trim();
  const fileName = path.basename(assetPath);
  platforms[rule.key] = {
    signature,
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(fileName)}`,
  };
}

if (Object.keys(platforms).length === 0) {
  throw new Error(`No updater-compatible artifacts found in ${assetsDir}`);
}

const latest = {
  version: normalizedVersion,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

await writeFile(outputPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
