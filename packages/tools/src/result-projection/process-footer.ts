/** Durations at or below this are omitted from the footer. */
const FOOTER_MIN_DURATION_MS = 1000;

/**
 * The one exit line for process output: `exit 0`, `exit 1 · 12.4s`, `timed out · exit 124 · 30.0s`,
 * `signal SIGKILL · exit 128`. Without an exit code, a non-completed status stands in (`running`, `lost`).
 */
export function processFooter(input: {
  exitCode?: number | null;
  status?: string;
  signal?: string | null;
  timedOut?: boolean;
  durationMs?: number;
}): string {
  const parts: string[] = [];
  if (input.timedOut) parts.push("timed out");
  if (input.signal) parts.push(`signal ${input.signal}`);
  if (input.exitCode != null) {
    const status = input.status;
    // Terminal statuses other than a plain exit (killed, lost, ...) stay visible next to the code.
    if (status && !["completed", "failed", "running"].includes(status))
      parts.push(status);
    parts.push(`exit ${input.exitCode}`);
  } else if (input.status && input.status !== "completed") {
    parts.push(input.status);
  } else if (parts.length === 0) {
    parts.push("exit unknown");
  }
  if (
    input.durationMs !== undefined &&
    input.durationMs > FOOTER_MIN_DURATION_MS
  )
    parts.push(`${(input.durationMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}
