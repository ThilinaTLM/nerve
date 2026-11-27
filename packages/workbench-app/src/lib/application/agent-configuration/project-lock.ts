/**
 * A project settings file that is not trusted: resolution ignores it, so its
 * settings column is locked. A missing document, or one without a trust
 * state (user files, unreadable documents), is not locked.
 */
export function isProjectLocked(
  document: { status?: string; trustState?: string | null } | undefined,
): boolean {
  return (document?.trustState ?? "trusted") !== "trusted";
}
