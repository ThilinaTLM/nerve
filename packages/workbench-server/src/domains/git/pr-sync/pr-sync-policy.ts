import type {
  GithubPr,
  GithubPrWatchSyncRequest,
} from "@nervekit/contracts/git";

export type PrDemand = Omit<GithubPrWatchSyncRequest, "projectId" | "repo">;
export const prRepoKey = (projectId: string, repo: string) =>
  JSON.stringify([projectId, repo]);

export class PrWatchRegistry {
  readonly owners = new Map<string, Map<string, PrDemand>>();
  sync(owner: string, key: string, demand: PrDemand) {
    let watches = this.owners.get(owner);
    if (!watches) this.owners.set(owner, (watches = new Map()));
    watches.set(key, demand);
  }
  clear(owner: string, key?: string) {
    if (key) {
      this.owners.get(owner)?.delete(key);
      if (!this.owners.get(owner)?.size) this.owners.delete(owner);
    } else this.owners.delete(owner);
  }
  demands(key: string): PrDemand[] {
    return [...this.owners.values()].flatMap((watches) =>
      watches.has(key) ? [watches.get(key)!] : [],
    );
  }
}

export function shownPrs(prs: GithubPr[], demands: PrDemand[]): GithubPr[] {
  return prs.filter((pr) =>
    demands.some(
      (demand) =>
        demand.visible &&
        (demand.list ||
          demand.prs.includes(pr.number) ||
          demand.activePr === pr.number ||
          demand.branch === pr.headRefName),
    ),
  );
}

export function nextPrProbe(input: {
  now: number;
  lastProbe: number | null;
  demands: PrDemand[];
  prs: GithubPr[];
  awaitingSince?: number;
  signalAt?: number;
  backoffUntil?: number;
  pollIntervalMs?: number;
  remaining?: number;
  limit?: number;
}): {
  tier: "hot" | "awaiting" | "warm" | "cold";
  repoAt: number | null;
  checksInterval: number;
} {
  const pending = shownPrs(input.prs, input.demands).some(
    (pr) => pr.checks.pending > 0,
  );
  const awaiting =
    input.awaitingSince !== undefined &&
    input.now - input.awaitingSince < 600_000;
  const visible = input.demands.some((demand) => demand.visible);
  const tier = pending
    ? "hot"
    : awaiting
      ? "awaiting"
      : visible
        ? "warm"
        : "cold";
  const stretch =
    input.limit &&
    input.remaining !== undefined &&
    input.remaining / input.limit < 0.2
      ? 4
      : 1;
  const interval =
    Math.max(
      input.pollIntervalMs ?? 0,
      tier === "hot"
        ? 30_000
        : tier === "awaiting"
          ? input.now - input.awaitingSince! < 60_000
            ? 10_000
            : 30_000
          : 60_000,
    ) * stretch;
  let repoAt =
    tier === "cold"
      ? null
      : input.lastProbe === null
        ? input.now
        : input.lastProbe + interval;
  if (input.signalAt !== undefined)
    repoAt = Math.min(repoAt ?? Infinity, input.signalAt + 2_000);
  if (repoAt !== null) repoAt = Math.max(repoAt, input.backoffUntil ?? 0);
  return {
    tier,
    repoAt,
    checksInterval: Math.max(10_000, input.pollIntervalMs ?? 0) * stretch,
  };
}

export function rateLimitBackoff(
  now: number,
  failures: number,
  headers: Headers,
): number {
  const retry = Number(headers.get("retry-after"));
  const retryDate = Date.parse(headers.get("retry-after") ?? "");
  const reset = Number(headers.get("x-ratelimit-reset")) * 1000;
  return Math.max(
    now + 60_000 * 2 ** Math.min(failures, 6),
    Number.isFinite(retry)
      ? now + retry * 1000
      : Number.isFinite(retryDate)
        ? retryDate
        : 0,
    headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset)
      ? reset
      : 0,
  );
}

export function retainPrs(prs: GithubPr[], demands: PrDemand[]): GithubPr[] {
  const branchLatest = new Set(
    demands.flatMap((demand) =>
      demand.branch
        ? prs
            .filter((pr) => pr.headRefName === demand.branch)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 1)
            .map((pr) => pr.number)
        : [],
    ),
  );
  const retained = (pr: GithubPr) =>
    branchLatest.has(pr.number) ||
    demands.some(
      (demand) =>
        demand.prs.includes(pr.number) || demand.activePr === pr.number,
    );
  const open = prs
    .filter((pr) => pr.state === "OPEN")
    .sort(
      (a, b) =>
        Number(retained(b)) - Number(retained(a)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 100);
  return [
    ...open,
    ...prs.filter((pr) => pr.state !== "OPEN" && retained(pr)),
  ].sort((a, b) => b.number - a.number);
}

export function diffPrs(before: GithubPr[], after: GithubPr[]) {
  const previous = new Map(before.map((pr) => [pr.number, pr]));
  const current = new Set(after.map((pr) => pr.number));
  return {
    changed: after
      .filter(
        (pr) => JSON.stringify(previous.get(pr.number)) !== JSON.stringify(pr),
      )
      .map((pr) => pr.number),
    removed: before
      .filter((pr) => !current.has(pr.number))
      .map((pr) => pr.number),
    checksChanged: after
      .filter(
        (pr) =>
          JSON.stringify(previous.get(pr.number)?.checks) !==
          JSON.stringify(pr.checks),
      )
      .map((pr) => pr.number),
  };
}
