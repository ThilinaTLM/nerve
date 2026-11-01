import { prSummaryFromCore } from "./pr-sync";
import type {
  GithubPr,
  GithubPrCore,
  GithubPrSnapshot,
  GithubPrWatchSyncRequest,
} from "@nervekit/contracts/git";
import {
  normalizeGitPrFilterConfig,
  type GitPrFilterConfig,
} from "../pr-filters";

export type PrFilters = GitPrFilterConfig & { head?: string };

export function filterRepoPrs(
  prs: readonly GithubPr[],
  filters: PrFilters,
  viewer: string | null,
  branch?: string | null,
): GithubPr[] {
  const f = normalizeGitPrFilterConfig(filters);
  const author =
    f.author === "me"
      ? viewer
      : f.author === "username"
        ? f.username
        : undefined;
  return prs
    .filter(
      (pr) =>
        pr.state === "OPEN" &&
        (f.author === "any" ||
          Boolean(
            author && pr.author?.toLowerCase() === author.toLowerCase(),
          )) &&
        (!f.reviewRequested || pr.reviewRequested) &&
        (f.drafts === "include" ||
          (f.drafts === "only" ? pr.isDraft : !pr.isDraft)) &&
        pr.title.toLowerCase().includes(f.title.toLowerCase()) &&
        (!filters.head || pr.headRefName === filters.head) &&
        (!f.currentBranchOnly ||
          Boolean(branch && pr.headRefName === branch)) &&
        f.labels.every((label) =>
          pr.labels.some(
            (candidate) => candidate.toLowerCase() === label.toLowerCase(),
          ),
        ),
    )
    .sort(
      (a, b) =>
        (f.sort === "updated-asc" ? 1 : -1) *
          a.updatedAt.localeCompare(b.updatedAt) || b.number - a.number,
    );
}

export function selectBranchPr(
  prs: readonly GithubPr[],
  branch?: string | null,
): GithubPr | undefined {
  return branch
    ? prs
        .filter((pr) => pr.headRefName === branch)
        .sort((a, b) => b.number - a.number)[0]
    : undefined;
}

export function acceptSnapshot(
  current: GithubPrSnapshot | undefined,
  incoming: GithubPrSnapshot,
): GithubPrSnapshot {
  return current && current.revision > incoming.revision ? current : incoming;
}

export type PrInterest = GithubPrWatchSyncRequest;
export function mergePrInterests(
  interests: readonly PrInterest[],
  visible: boolean,
): PrInterest | undefined {
  const first = interests[0];
  if (!first) return undefined;
  const shown = interests.filter((interest) => interest.visible);
  return {
    projectId: first.projectId,
    repo: first.repo,
    visible: visible && shown.length > 0,
    list: interests.some((interest) => interest.list),
    branch:
      shown.find((interest) => interest.branch)?.branch ??
      interests.find((interest) => interest.branch)?.branch,
    prs: [...new Set(interests.flatMap((interest) => interest.prs))].sort(
      (a, b) => a - b,
    ),
    activePr: shown.find((interest) => interest.activePr)?.activePr,
  };
}

/** Trailing debounce with serialized delivery: a clear can never overtake a sync. */
export class PrWatchDelivery {
  private timer?: ReturnType<typeof setTimeout>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly deliver: () => Promise<unknown>,
    private readonly delay = 80,
  ) {}
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.tail = this.tail
        .catch(() => undefined)
        .then(this.deliver)
        .catch(() => undefined);
    }, this.delay);
  }
}

export function mergePrCore(
  previous: GithubPr | undefined,
  core: GithubPrCore,
): GithubPr {
  if (previous && previous.updatedAt > core.updatedAt) return previous;
  const checks =
    previous?.headSha === core.headRefOid
      ? previous.checks
      : {
          status: "none" as const,
          total: 0,
          passed: 0,
          failed: 0,
          pending: 0,
          runs: [],
        };
  return {
    ...prSummaryFromCore(core, checks),
    labels: previous?.labels ?? [],
    reviewRequested: previous?.reviewRequested ?? false,
  };
}
