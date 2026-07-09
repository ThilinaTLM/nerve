/** Format a token count compactly (e.g. 1234 -> "1.2k", 2_000_000 -> "2M"). */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** Tone for a usage percentage: error >90, warning >70, otherwise neutral. */
export function usageTone(
  percent: number | null | undefined,
): "error" | "warning" | "neutral" {
  if (percent == null) return "neutral";
  if (percent > 90) return "error";
  if (percent > 70) return "warning";
  return "neutral";
}

/** Format a duration in minutes as compact days, hours, and minutes. */
export function formatDurationMinutes(
  totalMinutes: number | null | undefined,
): string | null {
  if (
    totalMinutes == null ||
    !Number.isFinite(totalMinutes) ||
    totalMinutes < 0
  ) {
    return null;
  }

  const wholeMinutes = Math.floor(totalMinutes);
  if (wholeMinutes === 0) return "0m";

  const days = Math.floor(wholeMinutes / (24 * 60));
  const hours = Math.floor((wholeMinutes % (24 * 60)) / 60);
  const minutes = wholeMinutes % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

/** Format an absolute reset timestamp as a compact countdown (e.g. "2h 15m"). */
export function formatResetAt(
  resetAt: string | null | undefined,
): string | null {
  if (!resetAt) return null;
  const target = new Date(resetAt).getTime();
  if (Number.isNaN(target)) return null;
  return formatCountdownMs(target - Date.now());
}

/** Format a relative reset (seconds from now) as a compact countdown. */
export function formatResetAfterSeconds(
  seconds: number | null | undefined,
): string | null {
  if (seconds == null || seconds <= 0) return null;
  return formatCountdownMs(seconds * 1000);
}

function formatCountdownMs(diffMs: number): string | null {
  if (diffMs <= 0) return null;
  return formatDurationMinutes(Math.floor(diffMs / 60_000));
}
