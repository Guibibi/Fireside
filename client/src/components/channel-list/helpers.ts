export function voiceHealthLabel(level: string): string {
  if (level === "good") return "Voice: Connected";
  if (level === "degraded") return "Voice: Reconnecting...";
  return "Voice: Failed";
}
