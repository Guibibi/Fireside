const MENTION_TOKEN_REGEX = /@([a-zA-Z0-9._-]{1,32})/g;

function isMentionBoundaryCharacter(value: string | undefined): boolean {
  if (!value) {
    return true;
  }

  return !/[a-zA-Z0-9._-]/.test(value);
}

export function extractMentionUsernames(content: string): string[] {
  const usernames: string[] = [];
  const seen = new Set<string>();

  MENTION_TOKEN_REGEX.lastIndex = 0;
  let match = MENTION_TOKEN_REGEX.exec(content);
  while (match) {
    const mentionStart = match.index;
    const mentionEnd = mentionStart + match[0].length;
    const before = content[mentionStart - 1];
    const after = content[mentionEnd];

    if (isMentionBoundaryCharacter(before) && isMentionBoundaryCharacter(after)) {
      const normalized = match[1].toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        usernames.push(match[1]);
      }
    }

    match = MENTION_TOKEN_REGEX.exec(content);
  }

  return usernames;
}

export function isMentioningUsername(content: string, targetUsername: string): boolean {
  const normalizedTarget = targetUsername.trim();
  if (!normalizedTarget) {
    return false;
  }

  const escapedTarget = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionTargetRegex = new RegExp(`@${escapedTarget}`, "gi");

  mentionTargetRegex.lastIndex = 0;
  let match = mentionTargetRegex.exec(content);
  while (match) {
    const mentionStart = match.index;
    const mentionEnd = mentionStart + match[0].length;
    const before = content[mentionStart - 1];
    const after = content[mentionEnd];

    if (isMentionBoundaryCharacter(before) && isMentionBoundaryCharacter(after)) {
      return true;
    }

    match = mentionTargetRegex.exec(content);
  }

  return false;
}
