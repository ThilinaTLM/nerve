import type {
  GithubPrSnapshot,
  GithubPrWatchSyncRequest,
  GithubPrSyncStatus,
} from "@nervekit/contracts/git";
import {
  GithubRateLimitError,
  GitWorkflowError,
  summarizeRestChecks,
  type GitService,
  type RestCheckRun,
  type RestCommitStatus,
} from "@nervekit/tools/git";
import {
  PrWatchRegistry,
  diffPrs,
  nextPrProbe,
  prRepoKey,
  rateLimitBackoff,
  retainPrs,
  shownPrs,
} from "./pr-sync-policy.js";

type Entry = {
  snapshot: GithubPrSnapshot;
  etag?: string;
  lastProbe: number | null;
  branchRequests: Set<string>;
  fingerprints: Map<number, string>;
  signalAt?: number;
  awaiting: Map<string, number>;
  backoffUntil?: number;
  failures: number;
  pollIntervalMs?: number;
  remaining?: number;
  limit?: number;
  timer?: ReturnType<typeof setTimeout>;
  flight?: Promise<void>;
  requested: Set<number>;
  checks: Map<
    string,
    {
      runs?: RestCheckRun[];
      status?: RestCommitStatus;
      runsTag?: string;
      statusTag?: string;
      firstAt: number;
      at: number;
    }
  >;
};
type Publisher = {
  publish(
    type: "github.pr.changed",
    data: {
      projectId: string;
      repo: string;
      revision: number;
      changed: number[];
      removed: number[];
      checksChanged: number[];
      status: GithubPrSyncStatus;
    },
  ): unknown;
};

/** Owns all GitHub PR polling and ephemeral snapshots; no transport or persistence dependencies. */
export class PrSyncService {
  readonly watches = new PrWatchRegistry();
  readonly #entries = new Map<string, Entry>();
  #closed = false;
  readonly #controller = new AbortController();
  readonly disposers: Array<() => void> = [];
  constructor(
    readonly git: Pick<
      GitService,
      | "prSyncAvailability"
      | "fetchPrSummaries"
      | "probePullRequests"
      | "probePrChecks"
    >,
    readonly events: Publisher,
    readonly now = Date.now,
  ) {}

  #entry(projectId: string, repo: string): Entry {
    const key = prRepoKey(projectId, repo);
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = {
        snapshot: {
          projectId,
          repo,
          revision: 0,
          repositoryUrl: null,
          status: "stale",
          updatedAt: null,
          retryAt: null,
          truncated: false,
          viewer: null,
          prs: [],
        },
        lastProbe: null,
        awaiting: new Map(),
        failures: 0,
        checks: new Map(),
        requested: new Set(),
        branchRequests: new Set(),
        fingerprints: new Map(),
      };
      this.#entries.set(key, entry);
    }
    return entry;
  }
  snapshot(projectId: string, repo: string): GithubPrSnapshot {
    const entry = this.#entry(projectId, repo);
    if (
      !entry.flight &&
      (entry.lastProbe === null || this.now() - entry.lastProbe > 60_000)
    )
      // Revalidate quietly; `updatedAt` already tells clients how old it is.
      this.signal(projectId, repo);
    return structuredClone(entry.snapshot);
  }
  cachedOpenPrs(projectId: string, repo: string, refresh = false) {
    const snapshot = this.snapshot(projectId, repo);
    if (refresh) this.signal(projectId, repo);
    return {
      result: { prs: snapshot.prs.filter((pr) => pr.state === "OPEN") },
      status:
        snapshot.status === "fresh"
          ? ("fresh" as const)
          : snapshot.status === "unavailable" ||
              snapshot.status === "unauthenticated"
            ? ("unavailable" as const)
            : ("stale" as const),
      refreshing:
        !!this.#entry(projectId, repo).flight ||
        this.#entry(projectId, repo).signalAt !== undefined,
      updatedAt: snapshot.updatedAt,
      failureCode:
        snapshot.status === "unauthenticated"
          ? "GH_AUTH_REQUIRED"
          : snapshot.status === "unavailable"
            ? "GH_NO_GITHUB_REMOTE"
            : undefined,
    };
  }
  sync(owner: string, request: GithubPrWatchSyncRequest) {
    const key = prRepoKey(request.projectId, request.repo);
    const previous = this.watches.owners.get(owner)?.get(key);
    this.watches.sync(owner, key, request);
    const entry = this.#entry(request.projectId, request.repo);
    if (
      !previous &&
      ["unavailable", "unauthenticated"].includes(entry.snapshot.status) &&
      entry.signalAt === undefined
    )
      this.#publish(entry, { ...entry.snapshot, status: "stale" });
    if (request.branch && previous?.branch !== request.branch)
      entry.branchRequests.add(request.branch);
    for (const number of [
      ...request.prs,
      ...(request.activePr ? [request.activePr] : []),
    ])
      if (!entry.snapshot.prs.some((pr) => pr.number === number))
        entry.requested.add(number);
    this.#retain(entry);
    if (
      entry.branchRequests.size ||
      entry.requested.size ||
      entry.lastProbe === null ||
      this.now() - entry.lastProbe > 60_000
    )
      this.signal(request.projectId, request.repo);
    else this.#schedule(entry);
    return { revision: entry.snapshot.revision };
  }
  clear(owner: string, projectId: string, repo: string) {
    this.watches.clear(owner, prRepoKey(projectId, repo));
    const entry = this.#entries.get(prRepoKey(projectId, repo));
    if (entry) {
      this.#retain(entry);
      this.#schedule(entry);
    }
    return { revision: entry?.snapshot.revision ?? 0 };
  }
  releaseOwner(owner: string) {
    this.watches.clear(owner);
    for (const entry of this.#entries.values()) {
      this.#retain(entry);
      this.#schedule(entry);
    }
  }
  expect(projectId: string, repo: string, branch: string) {
    const entry = this.#entry(projectId, repo);
    if (
      !entry.snapshot.prs.some(
        (pr) => pr.headRefName === branch && pr.state === "OPEN",
      )
    )
      entry.awaiting.set(branch, this.now());
    this.signal(projectId, repo);
    return { accepted: true };
  }
  signal(projectId: string, repo: string, number?: number) {
    if (this.#closed) return;
    const entry = this.#entry(projectId, repo);
    entry.signalAt ??= this.now();
    if (number) entry.requested.add(number);
    this.#schedule(entry);
  }
  merged(projectId: string, repo: string, number: number) {
    const entry = this.#entry(projectId, repo);
    this.#publish(entry, {
      ...entry.snapshot,
      prs: entry.snapshot.prs.map((pr) =>
        pr.number === number
          ? {
              ...pr,
              state: "MERGED",
              updatedAt: new Date(this.now()).toISOString(),
            }
          : pr,
      ),
    });
    this.signal(projectId, repo, number);
  }
  async refresh(projectId: string, repo: string, number?: number) {
    const entry = this.#entry(projectId, repo);
    if (number) entry.requested.add(number);
    entry.signalAt = this.now() - 2_000;
    if (!entry.backoffUntil || entry.backoffUntil <= this.now())
      await this.#run(entry, true);
    this.#schedule(entry);
    return structuredClone(entry.snapshot);
  }
  #demands(entry: Entry) {
    return this.watches.demands(
      prRepoKey(entry.snapshot.projectId, entry.snapshot.repo),
    );
  }
  #policy(entry: Entry) {
    const now = this.now();
    for (const [branch, since] of entry.awaiting)
      if (
        now - since >= 600_000 ||
        entry.snapshot.prs.some(
          (pr) => pr.headRefName === branch && pr.state === "OPEN",
        )
      )
        entry.awaiting.delete(branch);
    return nextPrProbe({
      now,
      lastProbe: entry.lastProbe,
      demands: this.#demands(entry),
      prs: entry.snapshot.prs,
      awaitingSince: entry.awaiting.size
        ? Math.min(...entry.awaiting.values())
        : undefined,
      signalAt: entry.signalAt,
      backoffUntil: entry.backoffUntil,
      pollIntervalMs: entry.pollIntervalMs,
      remaining: entry.remaining,
      limit: entry.limit,
    });
  }
  /**
   * Heads whose checks need REST probes. Summaries already carry checks, so a
   * visible list costs nothing extra; only pending checks, and focused PRs
   * (branch card, open tabs) whose new head may not have reported checks yet,
   * are probed.
   */
  #unsettled(entry: Entry) {
    const demands = this.#demands(entry);
    const focused = (number: number, head: string) =>
      demands.some(
        (demand) =>
          demand.visible &&
          (demand.prs.includes(number) ||
            demand.activePr === number ||
            demand.branch === head),
      );
    return shownPrs(entry.snapshot.prs, demands).filter((pr) => {
      if (!pr.headSha) return false;
      if (pr.checks.pending > 0) return true;
      if (pr.state !== "OPEN" || !focused(pr.number, pr.headRefName))
        return false;
      const cached = entry.checks.get(pr.headSha);
      return (
        !cached ||
        (pr.checks.total === 0 && this.now() - cached.firstAt < 60_000)
      );
    });
  }
  #schedule(entry: Entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    if (
      this.#closed ||
      entry.flight ||
      (["unavailable", "unauthenticated"].includes(entry.snapshot.status) &&
        entry.signalAt === undefined)
    )
      return;
    const policy = this.#policy(entry);
    const pending = this.#unsettled(entry);
    const checksAt = pending.length
      ? Math.min(
          ...pending.map(
            (pr) =>
              (entry.checks.get(pr.headSha)?.at ?? 0) + policy.checksInterval,
          ),
        )
      : Infinity;
    const at = Math.max(
      Math.min(policy.repoAt ?? Infinity, checksAt),
      entry.backoffUntil ?? 0,
    );
    if (!Number.isFinite(at)) return;
    entry.timer = setTimeout(
      () => {
        void this.#run(entry);
      },
      Math.max(0, at - this.now()),
    );
    entry.timer.unref();
  }
  #headers(entry: Entry, headers: Headers) {
    const remaining = headers.get("x-ratelimit-remaining"),
      limit = headers.get("x-ratelimit-limit");
    if (remaining !== null) entry.remaining = Number(remaining);
    if (limit !== null) entry.limit = Number(limit);
    entry.pollIntervalMs = Math.max(
      entry.pollIntervalMs ?? 0,
      Number(headers.get("x-poll-interval") ?? 0) * 1000,
    );
  }
  #retain(entry: Entry) {
    this.#publish(entry, {
      ...entry.snapshot,
      prs: retainPrs(entry.snapshot.prs, this.#demands(entry)),
    });
  }
  #publish(entry: Entry, snapshot: GithubPrSnapshot) {
    snapshot = {
      ...snapshot,
      prs: retainPrs(snapshot.prs, this.#demands(entry)),
    };
    const shas = new Set(snapshot.prs.map((pr) => pr.headSha));
    for (const sha of entry.checks.keys())
      if (!shas.has(sha)) entry.checks.delete(sha);
    const diff = diffPrs(entry.snapshot.prs, snapshot.prs);
    const before = { ...entry.snapshot, updatedAt: null, revision: 0 };
    const after = { ...snapshot, updatedAt: null, revision: 0 };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      entry.snapshot = snapshot;
      return;
    }
    entry.snapshot = { ...snapshot, revision: entry.snapshot.revision + 1 };
    try {
      void Promise.resolve(
        this.events.publish("github.pr.changed", {
          projectId: snapshot.projectId,
          repo: snapshot.repo,
          revision: entry.snapshot.revision,
          ...diff,
          status: snapshot.status,
        }),
      ).catch(() => {});
    } catch {
      /* Publication cannot fail a probe. */
    }
  }
  #run(entry: Entry, force = false): Promise<void> {
    if (entry.flight) return entry.flight;
    if (this.#closed || (entry.backoffUntil ?? 0) > this.now())
      return Promise.resolve();
    entry.flight = this.#fetch(entry, force).finally(() => {
      entry.flight = undefined;
      this.#schedule(entry);
    });
    return entry.flight;
  }
  async #fetch(entry: Entry, force: boolean) {
    const { projectId, repo } = entry.snapshot;
    try {
      const auth = await this.git.prSyncAvailability(
        projectId,
        repo,
        this.#controller.signal,
      );
      if (
        entry.snapshot.repositoryUrl &&
        entry.snapshot.repositoryUrl !== auth.repositoryUrl
      ) {
        entry.etag = undefined;
        entry.lastProbe = null;
        entry.fingerprints.clear();
        entry.checks.clear();
        entry.awaiting.clear();
        this.#publish(entry, {
          ...entry.snapshot,
          repositoryUrl: auth.repositoryUrl,
          prs: [],
          viewer: null,
          truncated: false,
          updatedAt: null,
          status: "stale",
          retryAt: null,
        });
      } else {
        this.#publish(entry, {
          ...entry.snapshot,
          repositoryUrl: auth.repositoryUrl,
        });
      }
      if (auth.status !== "ready") {
        entry.signalAt = undefined;
        this.#publish(entry, {
          ...entry.snapshot,
          status: auth.status,
        });
        return;
      }
      const policy = this.#policy(entry);
      const demands = this.#demands(entry);
      const branches = [
        ...new Set(
          demands.flatMap((demand) => (demand.branch ? [demand.branch] : [])),
        ),
      ];
      const repositoryDue =
        force ||
        entry.lastProbe === null ||
        (policy.repoAt !== null && policy.repoAt <= this.now());
      if (repositoryDue) {
        entry.signalAt = undefined;
        const requested = [...entry.requested];
        entry.requested.clear();
        const probe = await this.git.probePullRequests(
          projectId,
          repo,
          force ? undefined : entry.etag,
          this.#controller.signal,
        );
        this.#headers(entry, probe.headers);
        const branchRequests = [...entry.branchRequests];
        entry.branchRequests.clear();
        const changed =
          probe.status === 200
            ? probe.body.filter(
                (row) =>
                  entry.fingerprints.get(row.number) !==
                  JSON.stringify([row.updated_at, row.state, row.head.sha]),
              )
            : [];
        const reconcile =
          !entry.snapshot.updatedAt ||
          force ||
          changed.some((row) => {
            const known = entry.snapshot.prs.find(
              (pr) => pr.number === row.number,
            );
            return row.state === "open"
              ? !known || known.state !== "OPEN"
              : known?.state === "OPEN";
          });
        if (reconcile) {
          const full = await this.git.fetchPrSummaries(
            projectId,
            repo,
            undefined,
            branches,
            this.#controller.signal,
          );
          const watched = [
            ...new Set([
              ...requested,
              ...demands.flatMap((d) => d.prs),
              ...entry.snapshot.prs
                .filter(
                  (pr) => !full.prs.some((next) => next.number === pr.number),
                )
                .map((pr) => pr.number),
            ]),
          ];
          const extra = watched.length
            ? await this.git.fetchPrSummaries(
                projectId,
                repo,
                watched,
                [],
                this.#controller.signal,
              )
            : null;
          const prs = new Map(
            [...full.prs, ...(extra?.prs ?? [])].map((pr) => [pr.number, pr]),
          );
          this.#publish(entry, {
            ...entry.snapshot,
            viewer: full.viewer,
            truncated: full.truncated,
            prs: retainPrs([...prs.values()], demands),
          });
        } else {
          const numbers = [
            ...new Set([...requested, ...changed.map((row) => row.number)]),
          ];
          if (numbers.length || branchRequests.length) {
            const batch = await this.git.fetchPrSummaries(
              projectId,
              repo,
              numbers,
              branchRequests,
              this.#controller.signal,
            );
            const prs = new Map(
              [...entry.snapshot.prs, ...batch.prs].map((pr) => [
                pr.number,
                pr,
              ]),
            );
            this.#publish(entry, {
              ...entry.snapshot,
              viewer: batch.viewer,
              prs: retainPrs([...prs.values()], demands),
            });
          }
        }
        if (probe.status === 200) {
          entry.etag = probe.etag ?? undefined;
          entry.fingerprints = new Map(
            probe.body.map((row) => [
              row.number,
              JSON.stringify([row.updated_at, row.state, row.head.sha]),
            ]),
          );
        }
        entry.lastProbe = this.now();
      }
      const shas = new Set(this.#unsettled(entry).map((pr) => pr.headSha));
      for (const sha of shas) {
        const previous = entry.checks.get(sha);
        if (
          !force &&
          previous &&
          this.now() - previous.at < policy.checksInterval
        )
          continue;
        const probe = await this.git.probePrChecks(
          projectId,
          repo,
          sha,
          {
            runs: previous?.runsTag,
            status: previous?.statusTag,
          },
          this.#controller.signal,
        );
        this.#headers(entry, probe.runs.headers);
        this.#headers(entry, probe.status.headers);
        const runs =
          probe.runs.status === 200
            ? probe.runs.body.check_runs
            : (previous?.runs ?? []);
        const status =
          probe.status.status === 200
            ? probe.status.body
            : (previous?.status ?? { statuses: [] });
        entry.checks.set(sha, {
          runs,
          status,
          runsTag:
            probe.runs.status === 200
              ? (probe.runs.etag ?? undefined)
              : previous?.runsTag,
          statusTag:
            probe.status.status === 200
              ? (probe.status.etag ?? undefined)
              : previous?.statusTag,
          firstAt: previous?.firstAt ?? this.now(),
          at: this.now(),
        });
        const checks = summarizeRestChecks(runs, status);
        this.#publish(entry, {
          ...entry.snapshot,
          prs: entry.snapshot.prs.map((pr) =>
            pr.headSha === sha ? { ...pr, checks } : pr,
          ),
        });
      }
      entry.failures = 0;
      entry.backoffUntil = undefined;
      const lowBudget =
        entry.limit &&
        entry.remaining !== undefined &&
        entry.remaining / entry.limit < 0.2;
      this.#publish(entry, {
        ...entry.snapshot,
        status: lowBudget ? "rate_limited" : "fresh",
        retryAt: null,
        updatedAt: new Date(this.now()).toISOString(),
      });
    } catch (error) {
      if (this.#closed) return;
      if (
        error instanceof GitWorkflowError &&
        [
          "GH_AUTH_REQUIRED",
          "GH_CLI_UNAVAILABLE",
          "GH_NO_GITHUB_REMOTE",
          "GH_NO_REMOTE",
        ].includes(error.code)
      ) {
        entry.signalAt = undefined;
        this.#publish(entry, {
          ...entry.snapshot,
          status:
            error.code === "GH_AUTH_REQUIRED"
              ? "unauthenticated"
              : "unavailable",
          retryAt: null,
        });
        return;
      }
      const rateLimited = error instanceof GithubRateLimitError;
      entry.backoffUntil = rateLimited
        ? rateLimitBackoff(this.now(), entry.failures++, error.headers)
        : this.now() + 60_000;
      this.#publish(entry, {
        ...entry.snapshot,
        status: rateLimited ? "rate_limited" : "error",
        retryAt: new Date(entry.backoffUntil).toISOString(),
      });
    }
  }
  async close() {
    this.#closed = true;
    this.#controller.abort();
    for (const dispose of this.disposers) dispose();
    for (const entry of this.#entries.values())
      if (entry.timer) clearTimeout(entry.timer);
    await Promise.allSettled(
      [...this.#entries.values()].flatMap((entry) =>
        entry.flight ? [entry.flight] : [],
      ),
    );
    this.#entries.clear();
    this.watches.owners.clear();
  }
}
