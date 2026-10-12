import type { AsyncBash } from "@nervekit/contracts/core";

export function asyncBashDuration(
  bash: AsyncBash | undefined,
  now: number,
): string | undefined {
  if (!bash) return undefined;
  const start = Date.parse(bash.startedAt);
  const end =
    bash.status === "running"
      ? now
      : bash.finishedAt
        ? Date.parse(bash.finishedAt)
        : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return "Unknown duration";
  return `${Math.floor((end - start) / 1000)}s`;
}
