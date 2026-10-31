export const GIT_STALE_MS = 30_000;
export const GIT_OVERVIEW_AUTO_REFRESH_COOLDOWN_MS = 3_000;
export const GITHUB_STATUS_STALE_MS = 5 * 60_000;

export function isFresh(
  updatedAt: number | undefined,
  now: number,
  staleMs: number,
): boolean {
  return updatedAt !== undefined && now - updatedAt < staleMs;
}
