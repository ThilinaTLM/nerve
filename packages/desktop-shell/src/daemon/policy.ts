/**
 * Named immutable supervision policy values and pure restart decisions.
 * Behavior-defining constants live here so the supervisor state machine stays
 * free of magic numbers.
 */
export const DAEMON_SHUTDOWN_TIMEOUT_MS = 5000;
export const DAEMON_HEALTH_POLL_INTERVAL_MS = 5000;
export const DAEMON_UNHEALTHY_THRESHOLD = 3;
export const DAEMON_RESTART_BACKOFF_MS = Object.freeze([
  500, 1000, 2000, 5000, 10_000,
] as const);
export const DAEMON_MAX_RESTART_ATTEMPTS = 5;
export const DAEMON_HEALTHY_RESET_MS = 60_000;
export const DAEMON_READY_POLL_INTERVAL_MS = 200;

/** Backoff delay for a 1-based restart attempt, clamped to the last value. */
export function restartBackoffMs(attempt: number): number {
  return (
    DAEMON_RESTART_BACKOFF_MS[
      Math.min(Math.max(attempt, 1) - 1, DAEMON_RESTART_BACKOFF_MS.length - 1)
    ] ?? 10_000
  );
}

/** True when sustained health should reset the restart budget. */
export function shouldResetRestartBudget(
  lastHealthyAt: number,
  now: number,
): boolean {
  return now - lastHealthyAt > DAEMON_HEALTHY_RESET_MS;
}
