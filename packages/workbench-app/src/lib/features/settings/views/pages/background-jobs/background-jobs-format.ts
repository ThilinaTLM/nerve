import type { BackgroundJob } from "@nervekit/contracts/background-jobs";

/** "in 4 min", "2 h ago"; sub-minute distances read "now" / "in under a minute". */
export function formatJobTime(
  iso: string,
  now: number,
  /** A moment that has happened: clock skew cannot put it in the future. */
  happened = false,
): string {
  const delta = Math.min(Date.parse(iso) - now, happened ? 0 : Infinity);
  const minutes = Math.round(Math.abs(delta) / 60_000);
  if (minutes < 1) return delta > 0 ? "in under a minute" : "just now";
  const span =
    minutes < 60
      ? `${minutes} min`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  return delta > 0 ? `in ${span}` : `${span} ago`;
}

/** The muted line under a job: what the last run did and when the next one is. */
export function jobRunLine(job: BackgroundJob, now: number): string {
  const parts: string[] = [];
  if (job.status === "running") parts.push("Running now");
  else if (job.lastRun)
    parts.push(
      `Last run ${formatJobTime(job.lastRun.startedAt, now, true)}${
        job.lastRun.outcome.ok && job.lastRun.outcome.summary
          ? `: ${job.lastRun.outcome.summary}`
          : ""
      }`,
    );
  else parts.push("Not run yet");
  if (job.nextRun) parts.push(`Next run ${formatJobTime(job.nextRun, now)}`);
  return parts.join(" · ");
}
