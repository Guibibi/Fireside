const BULLET_PREFIXES = ["-", "*", "+"];

function normalizeLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return "";
  }

  for (const prefix of BULLET_PREFIXES) {
    if (trimmed.startsWith(`${prefix} `)) {
      return trimmed.slice(2).trim();
    }
  }

  return trimmed;
}

export function changelogItems(rawChangelog: string): string[] {
  const normalized = rawChangelog
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line.length > 0);

  if (normalized.length === 0) {
    return ["No release notes were provided for this update."];
  }

  return normalized;
}
