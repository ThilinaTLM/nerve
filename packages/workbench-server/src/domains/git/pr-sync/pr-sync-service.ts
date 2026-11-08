import type {
  GithubPrSnapshot,
  GithubPrWatchSyncRequest,
} from "@nervekit/contracts/git";
import {
  GithubRateLimitError,
  GitWorkflowError,
  summarizeRestChecks,
  type GitService,
} from "@nervekit/tools/git";
import {
  GithubRateBudget,
  PrWatchRegistry,
  diffPrs,
  githubKeyHost,
  githubRepoKey,
  nextPrProbe,
  prRepoKey,
  retainPrs,
  unsettledPrs,
  withBranchDemand,
  type PrDemand,
} from "./pr-sync-policy.js";
import {
  emptyPrSnapshot,
  type PrEntry,
  type PrPathRef,
  type PrPublisher,
} from "./pr-sync-types.js";

/** A path's remote is re-resolved at most this often (users add and change remotes). */
const RESOLVE_TTL_MS = 300_000;

/**
 * Owns all GitHub PR polling and ephemeral snapshots; no transport or persistence dependencies.
 * State is keyed by GitHub repository (`host/owner/name`): paths (worktrees,
 * clones, other projects) of one remote share a snapshot and a polling
 * schedule, and every repository of a host shares one rate-limit budget.
 * The client-facing API still addresses `(projectId, repo path)`.
 */
export class PrSyncService {
  readonly watches = new PrWatchRegistry();
  readonly #entries = new Map<string, PrEntry>();
  readonly #refs = new Map<string, PrPathRef>();
  readonly #budgets = new Map<string, GithubRateBudget>();
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
      | "repoRemoteState"
      | "resolveRepoDir"
    >,
    readonly events: PrPublisher,
    readonly now = Date.now,
  ) {}

  // ── Path binding ──────────────────────────────────────────────────────

  budget(host: string): GithubRateBudget {
    let budget = this.#budgets.get(host);
    if (!budget) this.#budgets.set(host, (budget = new GithubRateBudget()));
    return budget;
  }
  #budget(entry: PrEntry) {
    return this.budget(entry.host);
  }

  #entryFor(key: string): PrEntry {
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = {
        key,
        host: key.startsWith("path:") ? "" : githubKeyHost(key),
        paths: new Map(),
        snapshot: emptyPrSnapshot("", ""),
        lastProbe: null,
        awaiting: new Map(),
        checks: new Map(),
        requested: new Set(),
        branchRequests: new Set(),
        fingerprints: new Map(),
      };
      this.#entries.set(key, entry);
    }
    return entry;
  }

  /** The reference for a path; its GitHub key resolves asynchronously (`ready`). */
  #bind(projectId: string, repo: string): PrPathRef {
    const pathKey = prRepoKey(projectId, repo);
    let ref = this.#refs.get(pathKey);
    if (!ref) {
      ref = {
        projectId,
        repo,
        pathKey,
        ready: Promise.resolve(),
        resolvedAt: 0,
        resolving: false,
      };
      this.#refs.set(pathKey, ref);
      ref.ready = this.#attach(ref);
    } else if (
      ref.entry &&
      !ref.resolving &&
      this.now() - ref.resolvedAt > RESOLVE_TTL_MS
    )
      ref.ready = this.#attach(ref);
    return ref;
  }
  async #resolveKey(ref: PrPathRef): Promise<string> {
    try {
      const state = await this.git.repoRemoteState(
        this.git.resolveRepoDir(ref.projectId, ref.repo),
      );
      const github = state.githubRepository;
      return github
        ? githubRepoKey(github.hostname, github.owner, github.repo)
        : `path:${ref.pathKey}`;
    } catch {
      return `path:${ref.pathKey}`;
    }
  }
  async #attach(ref: PrPathRef) {
    ref.resolving = true;
    try {
      const key = await this.#resolveKey(ref);
      if (this.#closed) return;
      ref.resolvedAt = this.now();
      this.#move(ref, key);
    } finally {
      ref.resolving = false;
    }
  }
  /** Bind `ref` to the entry for `key`, leaving the previous one. */
  #move(ref: PrPathRef, key: string) {
    const old = ref.entry;
    if (old?.key === key) return;
    if (old) {
      old.paths.delete(ref.pathKey);
      if (!old.paths.size) {
        if (old.timer) clearTimeout(old.timer);
        old.signalAt = undefined;
        this.#entries.delete(old.key);
      } else {
        this.#retain(old);
        this.#schedule(old);
      }
    }
    const entry = this.#entryFor(key);
    entry.paths.set(ref.pathKey, ref);
    ref.entry = entry;
    // The client holds a placeholder (or the old remote's PRs): have it read the shared snapshot.
    if (entry.snapshot.revision > 0 || old)
      this.#publishTo(ref, entry, {
        changed: entry.snapshot.prs.map((pr) => pr.number),
        removed: [],
        checksChanged: [],
      });
  }
  /** Run `act` once the path is bound; immediately when it already is. */
  #whenBound(ref: PrPathRef, act: (entry: PrEntry) => void) {
    if (ref.entry) return act(ref.entry);
    void ref.ready.then(() => {
      if (ref.entry && !this.#closed) act(ref.entry);
    });
  }
  #view(ref: PrPathRef, entry: PrEntry | undefined): GithubPrSnapshot {
    return structuredClone({
      ...(entry?.snapshot ?? emptyPrSnapshot(ref.projectId, ref.repo)),
      projectId: ref.projectId,
      repo: ref.repo,
    });
  }
  #stale(entry: PrEntry) {
    return (
      !entry.flight &&
      (entry.lastProbe === null || this.now() - entry.lastProbe > 60_000)
    );
  }

  // ── Client API ────────────────────────────────────────────────────────

  snapshot(projectId: string, repo: string): GithubPrSnapshot {
    const ref = this.#bind(projectId, repo);
    // Revalidate quietly; `updatedAt` already tells clients how old it is.
    this.#whenBound(ref, (entry) => {
      if (this.#stale(entry)) this.#signalEntry(entry);
    });
    return this.#view(ref, ref.entry);
  }
  cachedOpenPrs(projectId: string, repo: string, refresh = false) {
    const snapshot = this.snapshot(projectId, repo);
    if (refresh) this.signal(projectId, repo);
    const entry = this.#bind(projectId, repo).entry;
    return {
      result: { prs: snapshot.prs.filter((pr) => pr.state === "OPEN") },
      status:
        snapshot.status === "fresh"
          ? ("fresh" as const)
          : snapshot.status === "unavailable" ||
              snapshot.status === "unauthenticated"
            ? ("unavailable" as const)
            : ("stale" as const),
      refreshing: !!entry && (!!entry.flight || entry.signalAt !== undefined),
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
    const ref = this.#bind(request.projectId, request.repo);
    const previous = this.watches.owners.get(owner)?.get(ref.pathKey);
    this.watches.sync(owner, ref.pathKey, request);
    this.#whenBound(ref, (entry) => {
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
        this.#stale(entry) ||
        (entry.lastProbe !== null && this.now() - entry.lastProbe > 60_000)
      )
        this.#signalEntry(entry);
      else this.#schedule(entry);
    });
    return { revision: ref.entry?.snapshot.revision ?? 0 };
  }
  clear(owner: string, projectId: string, repo: string) {
    const pathKey = prRepoKey(projectId, repo);
    this.watches.clear(owner, pathKey);
    const entry = this.#refs.get(pathKey)?.entry;
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

  // ── Server signals ────────────────────────────────────────────────────

  /**
   * A worktree's current branch (from `GitWorkspaceSync`), so the branch's PR
   * is tracked without the client relaying branch names. `previous` is
   * undefined on the first read of the worktree.
   */
  branchChanged(change: {
    projectId: string;
    repo: string;
    branch: string | null;
    detached: boolean;
    previous?: string | null;
  }) {
    if (this.#closed) return;
    const ref = this.#bind(change.projectId, change.repo);
    const branch = change.detached ? null : change.branch;
    ref.branch = branch;
    this.#whenBound(ref, (entry) => {
      if (
        branch &&
        change.previous !== undefined &&
        change.previous !== branch
      ) {
        // A switch: its PR may not be known yet.
        entry.branchRequests.add(branch);
        this.#retain(entry);
        this.#signalEntry(entry);
      } else {
        this.#retain(entry);
        this.#schedule(entry);
      }
    });
  }
  expect(projectId: string, repo: string, branch: string) {
    this.#whenBound(this.#bind(projectId, repo), (entry) => {
      if (
        !entry.snapshot.prs.some(
          (pr) => pr.headRefName === branch && pr.state === "OPEN",
        )
      )
        entry.awaiting.set(branch, this.now());
      this.#signalEntry(entry);
    });
    return { accepted: true };
  }
  signal(projectId: string, repo: string, number?: number) {
    if (this.#closed) return;
    this.#whenBound(this.#bind(projectId, repo), (entry) => {
      if (number) entry.requested.add(number);
      this.#signalEntry(entry);
    });
  }
  #signalEntry(entry: PrEntry) {
    if (this.#closed) return;
    entry.signalAt ??= this.now();
    this.#schedule(entry);
  }
  merged(projectId: string, repo: string, number: number) {
    this.#whenBound(this.#bind(projectId, repo), (entry) => {
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
      entry.requested.add(number);
      this.#signalEntry(entry);
    });
  }
  async refresh(projectId: string, repo: string, number?: number) {
    const ref = this.#bind(projectId, repo);
    await ref.ready;
    // A remote change found by the probe moves the path; probe its new entry too.
    for (let round = 0; round < 2 && ref.entry && !this.#closed; round++) {
      const entry = ref.entry;
      if (number) entry.requested.add(number);
      entry.signalAt = this.now() - 2_000;
      if (this.#blockedUntil(entry) <= this.now()) await this.#run(entry, true);
      this.#schedule(entry);
      if (ref.entry === entry) break;
    }
    return this.#view(ref, ref.entry);
  }

  // ── Policy inputs ─────────────────────────────────────────────────────

  #blockedUntil(entry: PrEntry) {
    return Math.max(
      entry.backoffUntil ?? 0,
      entry.host ? this.#budget(entry).blockedUntil(this.now()) : 0,
    );
  }
  /** Explicit watches of every path plus the workspace-reported branch of each. */
  #demands(entry: PrEntry): PrDemand[] {
    return [...entry.paths.values()].flatMap((ref) =>
      withBranchDemand(this.watches.demands(ref.pathKey), ref.branch),
    );
  }
  #policy(entry: PrEntry) {
    const now = this.now();
    for (const [branch, since] of entry.awaiting)
      if (
        now - since >= 600_000 ||
        entry.snapshot.prs.some(
          (pr) => pr.headRefName === branch && pr.state === "OPEN",
        )
      )
        entry.awaiting.delete(branch);
    const budget = entry.host ? this.#budget(entry) : undefined;
    return nextPrProbe({
      now,
      lastProbe: entry.lastProbe,
      demands: this.#demands(entry),
      prs: entry.snapshot.prs,
      awaitingSince: entry.awaiting.size
        ? Math.min(...entry.awaiting.values())
        : undefined,
      signalAt: entry.signalAt,
      backoffUntil: this.#blockedUntil(entry) || undefined,
      pollIntervalMs: entry.pollIntervalMs,
      remaining: budget?.low(now) ? budget.remaining : undefined,
      limit: budget?.low(now) ? budget.limit : undefined,
    });
  }
  /**
   * Heads whose checks need REST probes. Summaries already carry checks, so a
   * visible list costs nothing extra; only pending checks, and focused PRs
   * (branch card, open tabs) whose new head may not have reported checks yet,
   * are probed.
   */
  #unsettled(entry: PrEntry) {
    return unsettledPrs({
      now: this.now(),
      prs: entry.snapshot.prs,
      demands: this.#demands(entry),
      checks: entry.checks,
    });
  }
  #schedule(entry: PrEntry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    if (
      this.#closed ||
      entry.flight ||
      !entry.paths.size ||
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
      this.#blockedUntil(entry),
    );
    if (!Number.isFinite(at)) return;
    this.#arm(entry, at);
  }
  #arm(entry: PrEntry, at: number) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => {
        void this.#run(entry);
      },
      Math.max(0, at - this.now()),
    );
    entry.timer.unref();
  }
  #headers(entry: PrEntry, headers: Headers) {
    if (entry.host) this.#budget(entry).observe(headers);
    entry.pollIntervalMs = Math.max(
      entry.pollIntervalMs ?? 0,
      Number(headers.get("x-poll-interval") ?? 0) * 1000,
    );
  }
  #retain(entry: PrEntry) {
    this.#publish(entry, {
      ...entry.snapshot,
      prs: retainPrs(entry.snapshot.prs, this.#demands(entry)),
    });
  }
  #publish(entry: PrEntry, snapshot: GithubPrSnapshot) {
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
    // Paths with demand are told; without any demand, every path is.
    const watched = [...entry.paths.values()].filter(
      (ref) => this.watches.demands(ref.pathKey).length,
    );
    for (const ref of watched.length ? watched : entry.paths.values())
      this.#publishTo(ref, entry, diff);
  }
  #publishTo(
    ref: PrPathRef,
    entry: PrEntry,
    diff: { changed: number[]; removed: number[]; checksChanged: number[] },
  ) {
    try {
      void Promise.resolve(
        this.events.publish("github.pr.changed", {
          projectId: ref.projectId,
          repo: ref.repo,
          revision: entry.snapshot.revision,
          ...diff,
          status: entry.snapshot.status,
        }),
      ).catch(() => {});
    } catch {
      /* Publication cannot fail a probe. */
    }
  }
  #run(entry: PrEntry, force = false): Promise<void> {
    if (entry.flight) return entry.flight;
    const now = this.now();
    if (this.#closed || this.#blockedUntil(entry) > now)
      return Promise.resolve();
    if (!force && entry.host) {
      // Stagger probe cycles of all repositories of the host.
      if (entry.slot === undefined) {
        const slot = this.#budget(entry).reserve(now);
        if (slot > now) entry.slot = slot;
      }
      if (entry.slot !== undefined && entry.slot > now) {
        this.#arm(entry, entry.slot);
        return Promise.resolve();
      }
      entry.slot = undefined;
    }
    entry.flight = this.#fetch(entry, force).finally(() => {
      entry.flight = undefined;
      this.#schedule(entry);
    });
    return entry.flight;
  }
  async #fetch(entry: PrEntry, force: boolean) {
    const rep = [...entry.paths.values()].sort(
      (a, b) =>
        Number(!this.watches.demands(a.pathKey).length) -
        Number(!this.watches.demands(b.pathKey).length),
    )[0];
    if (!rep) return;
    const { projectId, repo } = rep;
    try {
      const auth = await this.git.prSyncAvailability(
        projectId,
        repo,
        this.#controller.signal,
      );
      const authKey = auth.repositoryUrl
        ? (({ hostname, pathname }) => `${hostname}${pathname}`.toLowerCase())(
            new URL(auth.repositoryUrl),
          )
        : `path:${rep.pathKey}`;
      if (authKey !== entry.key) {
        // The remote changed since the path was bound: continue on the new remote's entry.
        rep.resolvedAt = this.now();
        this.#move(rep, authKey);
        if (rep.entry) this.#signalEntry(rep.entry);
        return;
      }
      this.#publish(entry, {
        ...entry.snapshot,
        repositoryUrl: auth.repositoryUrl,
      });
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
      entry.backoffUntil = undefined;
      this.#budget(entry).succeeded();
      const lowBudget = this.#budget(entry).low(this.now());
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
      // Rate limits (primary or secondary) block every repository of the host.
      const retryAt = rateLimited
        ? this.#budget(entry).limited(this.now(), error.headers)
        : (entry.backoffUntil = this.now() + 60_000);
      this.#publish(entry, {
        ...entry.snapshot,
        status: rateLimited ? "rate_limited" : "error",
        retryAt: new Date(retryAt).toISOString(),
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
    this.#refs.clear();
    this.watches.owners.clear();
  }
}
