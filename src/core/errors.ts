/** Human-readable message for any thrown value. Never throws. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'string') {
    return e;
  }
  try {
    return String(e);
  } catch {
    return 'Unknown error';
  }
}

/** English-only heuristic; localized builds may not match, so callers also surface the raw message. */
export function looksLikePolicyError(message: string): boolean {
  return /polic/i.test(message);
}
