import type { GitRepoSummary } from "@nervekit/contracts/git";

type SyncFacts = Pick<
  GitRepoSummary,
  | "detached"
  | "hasUpstream"
  | "hasRemote"
  | "ahead"
  | "behind"
  | "unpublishedCount"
>;

/** One supporting line for a branch: how it relates to its upstream. */
export function branchStatusLine(summary: SyncFacts): string {
  if (summary.detached) return "Detached HEAD";
  if (!summary.hasUpstream) {
    if (!summary.hasRemote) return "No remote";
    const unpublished = summary.unpublishedCount;
    return unpublished
      ? `${unpublished} unpublished ${unpublished === 1 ? "commit" : "commits"} · not pushed`
      : "Not pushed";
  }
  const parts: string[] = [];
  if (summary.ahead) parts.push(`${summary.ahead} ahead`);
  if (summary.behind) parts.push(`${summary.behind} behind`);
  return parts.length ? parts.join(" · ") : "Up to date";
}

/** Standalone Git screen subtitle: branch plus compact sync arrows. */
export function branchSubtitle(
  summary: (SyncFacts & { currentBranch: string | null }) | undefined,
): string | undefined {
  if (!summary) return undefined;
  const sync: string[] = [];
  if (summary.ahead) sync.push(`↑${summary.ahead}`);
  if (summary.behind) sync.push(`↓${summary.behind}`);
  return [summary.currentBranch ?? "detached", sync.join(" ")]
    .filter(Boolean)
    .join(" · ");
}
