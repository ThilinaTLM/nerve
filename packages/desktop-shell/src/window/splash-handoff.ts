export const SPLASH_ELAPSED_PARAM = "nerveSplashElapsedMs";

/** Longer hand-offs are already past the intro, so the exact value stops mattering. */
const MAX_ELAPSED_MS = 10_000;

/**
 * Tells the workbench how far the shell already played the startup intro so it
 * resumes the same timeline instead of restarting it after navigation.
 */
export function withSplashElapsed(
  daemonUrl: string,
  elapsedMs: number,
): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return daemonUrl;
  const clamped = Math.min(MAX_ELAPSED_MS, Math.round(elapsedMs));
  const url = new URL(daemonUrl);
  url.searchParams.set(SPLASH_ELAPSED_PARAM, String(clamped));
  return url.toString();
}
