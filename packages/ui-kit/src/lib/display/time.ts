export function timeLabel(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

export type RelativeTimeOptions = {
  /** `compact` ("now", "5m") for dense rows; `long` ("just now", "5m ago") for prose. */
  style?: "compact" | "long";
  now?: number;
};

/**
 * Age of a timestamp in the largest whole unit: "now", "5m", "3h", "2d",
 * "4w", "6mo", "1y", or with `style: "long"` "just now", "5m ago", …. Every
 * unit rounds down, so "1h" means at least an hour has passed. Missing or
 * unparsable timestamps give "".
 */
export function relativeTimeLabel(
  ts: string | undefined,
  { style = "compact", now = Date.now() }: RelativeTimeOptions = {},
): string {
  if (!ts) return "";
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return "";
  const age = compactAge(Math.max(0, now - then));
  if (style === "compact") return age;
  return age === "now" ? "just now" : `${age} ago`;
}

function compactAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

/** Elapsed time as a clock: "0:07", "12:34", "75:00" (minutes do not roll over). */
export function formatElapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function dateTimeLabel(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
