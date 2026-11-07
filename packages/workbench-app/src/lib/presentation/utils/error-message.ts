export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorMessageOr(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}
