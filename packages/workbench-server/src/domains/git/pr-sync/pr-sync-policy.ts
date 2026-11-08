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

/** Explicit demands of one path plus its workspace-reported branch (visible when the path is). */
export function withBranchDemand(
  real: PrDemand[],
  branch: string | null | undefined,
): PrDemand[] {
  if (!branch || real.some((demand) => demand.branch === branch)) return real;
  return [
    ...real,
    {
      visible: real.some((demand) => demand.visible),
      list: false,
      prs: [],
      branch,
    },
  ];
}

/**
 * Heads whose checks need REST probes. Summaries already carry checks, so a
 * visible list costs nothing extra; only pending checks, and focused PRs
 * (branch card, open tabs) whose new head may not have reported checks yet,
 * are probed.
 */
export function unsettledPrs(input: {
  now: number;
  prs: GithubPr[];
  demands: PrDemand[];
  checks: ReadonlyMap<string, { firstAt: number }>;
}): GithubPr[] {
  const focused = (number: number, head: string) =>
    input.demands.some(
      (demand) =>
        demand.visible &&
        (demand.prs.includes(number) ||
          demand.activePr === number ||
          demand.branch === head),
    );
  return shownPrs(input.prs, input.demands).filter((pr) => {
    if (!pr.headSha) return false;
    if (pr.checks.pending > 0) return true;
    if (pr.state !== "OPEN" || !focused(pr.number, pr.headRefName))
      return false;
    const cached = input.checks.get(pr.headSha);
    return (
      !cached || (pr.checks.total === 0 && input.now - cached.firstAt < 60_000)
    );
  });
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

/** `host/owner/name`, lowercased: the key PR sync shares between worktrees and clones of one remote. */
export const githubRepoKey = (hostname: string, owner: string, name: string) =>
  `${hostname}/${owner}/${name}`.toLowerCase();

/** Hosts have independent rate limits; the key's first segment names it. */
export const githubKeyHost = (key: string) => key.split("/")[0] ?? key;

/**
 * Daemon-wide GitHub request budget for one host, shared by every repository
 * so many repositories cannot exhaust the limit together. It tracks the last
 * rate-limit headers, one shared backoff for primary and secondary limits
 * (`retry-after`, reset time, exponential on repeats), and spaces out the
 * start of probe cycles. Pure: callers pass the clock.
 */
export class GithubRateBudget {
  remaining?: number;
  limit?: number;
  resetAt?: number;
  #blockedUntil = 0;
  #failures = 0;
  #nextSlot = 0;
  constructor(
    /** Minimum spacing between the starts of two probe cycles. */
    readonly minSpacingMs = 250,
    /** Below this share of the limit, polling is stretched. */
    readonly lowRatio = 0.2,
  ) {}
  observe(headers: Headers) {
    const remaining = headers.get("x-ratelimit-remaining"),
      limit = headers.get("x-ratelimit-limit"),
      reset = headers.get("x-ratelimit-reset");
    if (remaining !== null && Number.isFinite(Number(remaining)))
      this.remaining = Number(remaining);
    if (limit !== null && Number.isFinite(Number(limit)))
      this.limit = Number(limit);
    if (reset !== null && Number.isFinite(Number(reset)))
      this.resetAt = Number(reset) * 1000;
  }
  /** Until when requests must not start; 0 when free. */
  blockedUntil(now: number): number {
    return this.#blockedUntil > now ? this.#blockedUntil : 0;
  }
  /** A limit was hit (primary or secondary); every repository waits. Returns the end of the block. */
  limited(now: number, headers: Headers): number {
    this.observe(headers);
    this.#blockedUntil = Math.max(
      this.#blockedUntil,
      rateLimitBackoff(now, this.#failures++, headers),
    );
    return this.#blockedUntil;
  }
  succeeded() {
    this.#failures = 0;
  }
  /** Budget is nearly spent (and not yet reset): poll less. */
  low(now: number): boolean {
    return (
      !!this.limit &&
      this.remaining !== undefined &&
      this.remaining / this.limit < this.lowRatio &&
      (this.resetAt === undefined || this.resetAt > now)
    );
  }
  /**
   * Claim the start time of the next probe cycle: not before a block ends and
   * at least `minSpacingMs` after the previously claimed one.
   */
  reserve(now: number): number {
    const at = Math.max(now, this.#blockedUntil, this.#nextSlot);
    this.#nextSlot = at + this.minSpacingMs;
    return at;
  }
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
