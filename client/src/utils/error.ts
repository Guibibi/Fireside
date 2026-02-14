export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error || fallback;
  return error instanceof Error ? error.message : fallback;
}
