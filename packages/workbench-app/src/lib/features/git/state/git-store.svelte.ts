import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type {
  GitRepoDetailSnapshot,
  GitWorkspaceSnapshot,
} from "@nervekit/contracts/git";
import {
  clearGitWorkspaceWatch,
  getGitRepoDetail,
  getGitWorkspaceSnapshot,
  refreshGitWorkspace,
  syncGitWorkspaceWatch,
} from "../api/git.api";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { PrWatchDelivery } from "./pr-store-model";
import {
  acceptRevision,
  CoalescedRead,
  isEmptyGitInterest,
  mergeGitInterests,
  needsRevisionWait,
  planEventReads,
  type GitInterest,
} from "./git-store-model";

/**
 * Server-owned Git workspace, mirrored per project: one snapshot of every
 * repository summary plus a detail snapshot (files, stashes) per worktree the
 * client reads. The client declares demand with `git.workspace.watch.sync`,
 * the server pushes `git.workspace.changed` pings and the client re-reads.
 */

type ProjectEntry = {
  snapshot?: GitWorkspaceSnapshot;
  details: Record<string, GitRepoDetailSnapshot>;
  /** Highest project revision whose reads completed (events and mutations). */
  applied: number;
  error?: string;
  refreshing: boolean;
  loadingDetail: Record<string, boolean>;
};

const projects = $state<Record<string, ProjectEntry>>({});
const hints = $state<Record<string, string>>({});
const interests = new SvelteMap<symbol, GitInterest>();
const sent = new SvelteMap<string, GitInterest>();
const snapshotReads = new SvelteMap<string, CoalescedRead>();
const detailReads = new SvelteMap<string, CoalescedRead>();
const inflightEvents = new SvelteMap<
  string,
  { revision: number; done: Promise<void> }
>();
const hintTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();
const listeners = new SvelteMap<symbol, (projectId: string) => void>();
let epoch = 0;

const HINT_MS = 4_000;

function entry(projectId: string): ProjectEntry {
  return (projects[projectId] ??= {
    details: {},
    applied: -1,
    refreshing: false,
    loadingDetail: {},
  });
}

// ── Selectors ───────────────────────────────────────────────────────────

export function gitWorkspaceSnapshot(
  projectId: string,
): GitWorkspaceSnapshot | undefined {
  return projects[projectId]?.snapshot;
}

export function gitRepoDetail(
  projectId: string,
  repo: string,
): GitRepoDetailSnapshot | undefined {
  return projects[projectId]?.details[repo];
}

export function gitWorkspaceStatus(projectId: string): {
  error?: string;
  refreshing: boolean;
} {
  const state = projects[projectId];
  return { error: state?.error, refreshing: state?.refreshing ?? false };
}

export function gitRepoDetailLoading(projectId: string, repo: string): boolean {
  return projects[projectId]?.loadingDetail[repo] ?? false;
}

export function gitHintedRepo(projectId: string): string | undefined {
  return hints[projectId];
}

/** Hover or keyboard focus on a branch row: "may be selected soon". */
export function hintGitRepo(projectId: string, repo: string): void {
  hints[projectId] = repo;
  clearTimeout(hintTimers.get(projectId));
  hintTimers.set(
    projectId,
    setTimeout(() => {
      hintTimers.delete(projectId);
      delete hints[projectId];
    }, HINT_MS),
  );
}

/** Notified after a snapshot or detail was ingested, or a change ping was handled. */
export function onGitWorkspaceChange(
  listener: (projectId: string) => void,
): () => void {
  const token = Symbol();
  listeners.set(token, listener);
  return () => listeners.delete(token);
}

// ── Ingest ──────────────────────────────────────────────────────────────

export function ingestGitWorkspaceSnapshot(
  snapshot: GitWorkspaceSnapshot,
): void {
  const state = entry(snapshot.projectId);
  const accepted = acceptRevision(state.snapshot, snapshot);
  if (accepted !== snapshot) return;
  state.snapshot = snapshot;
  state.error = undefined;
  const known = new SvelteSet(snapshot.summaries.map((s) => s.relativePath));
  if (snapshot.loaded)
    for (const repo of Object.keys(state.details))
      if (!known.has(repo)) delete state.details[repo];
  notify(snapshot.projectId);
}

export function ingestGitRepoDetail(detail: GitRepoDetailSnapshot): void {
  const state = entry(detail.projectId);
  const accepted = acceptRevision(state.details[detail.repo], detail);
  if (accepted !== detail) return;
  state.details[detail.repo] = detail;
  notify(detail.projectId);
}

function notify(projectId: string): void {
  for (const listener of listeners.values()) listener(projectId);
}

// ── Reads ───────────────────────────────────────────────────────────────

function snapshotReader(projectId: string): CoalescedRead {
  let reader = snapshotReads.get(projectId);
  if (!reader) {
    reader = new CoalescedRead(async () => {
      const at = epoch;
      try {
        const snapshot = await getGitWorkspaceSnapshot(projectId);
        if (at === epoch) ingestGitWorkspaceSnapshot(snapshot);
      } catch (error) {
        entry(projectId).error = String(error);
      }
    });
    snapshotReads.set(projectId, reader);
  }
  return reader;
}

function detailReader(projectId: string, repo: string): CoalescedRead {
  const key = JSON.stringify([projectId, repo]);
  let reader = detailReads.get(key);
  if (!reader) {
    reader = new CoalescedRead(async () => {
      const at = epoch;
      const state = entry(projectId);
      state.loadingDetail[repo] = !state.details[repo];
      try {
        const detail = await getGitRepoDetail(projectId, repo);
        if (at === epoch) ingestGitRepoDetail(detail);
      } catch (error) {
        state.error = String(error);
      } finally {
        state.loadingDetail[repo] = false;
      }
    });
    detailReads.set(key, reader);
  }
  return reader;
}

/** Read the latest workspace snapshot; the result is never older than the call. */
export function readGitWorkspace(projectId: string): Promise<void> {
  return snapshotReader(projectId).fresh();
}

export function readGitRepoDetail(
  projectId: string,
  repo: string,
): Promise<void> {
  return detailReader(projectId, repo).fresh();
}

/** Manual refresh: the server re-reads at once, then the client reads the result. */
export async function refreshGitWorkspaceNow(
  projectId: string,
  repo?: string,
): Promise<void> {
  const state = entry(projectId);
  state.refreshing = true;
  try {
    await refreshGitWorkspace(projectId, repo, true);
    await readHeld(projectId, repo);
  } finally {
    state.refreshing = false;
  }
}

function readHeld(projectId: string, repo?: string): Promise<unknown> {
  const state = entry(projectId);
  const details = repo
    ? state.details[repo]
      ? [repo]
      : []
    : Object.keys(state.details);
  return Promise.all([
    readGitWorkspace(projectId),
    ...details.map((held) => readGitRepoDetail(projectId, held)),
  ]);
}

/**
 * Wait until the workspace includes a mutation's `workspaceRevision`. The
 * server already read the effect before answering, so this is a memory read
 * (or the ping read that is already running), never a repository scan.
 */
export async function awaitGitWorkspaceRevision(
  projectId: string,
  revision: number | undefined,
  repo?: string,
): Promise<void> {
  const state = entry(projectId);
  if (!needsRevisionWait(state.applied, revision) || revision === undefined)
    return;
  const inflight = inflightEvents.get(projectId);
  if (inflight && inflight.revision >= revision) await inflight.done;
  if (!needsRevisionWait(state.applied, revision)) return;
  await readHeld(projectId, repo);
  state.applied = Math.max(state.applied, revision);
}

// ── Demand ──────────────────────────────────────────────────────────────

const delivery = new PrWatchDelivery(async () => {
  const at = epoch;
  const byProject = new SvelteMap<string, GitInterest[]>();
  for (const interest of interests.values())
    byProject.set(interest.projectId, [
      ...(byProject.get(interest.projectId) ?? []),
      interest,
    ]);
  for (const projectId of [...sent.keys()])
    if (!byProject.has(projectId)) {
      await clearGitWorkspaceWatch(projectId);
      sent.delete(projectId);
    }
  for (const [projectId, local] of byProject) {
    const merged = mergeGitInterests(
      local,
      typeof document === "undefined" || document.visibilityState === "visible",
    )!;
    if (JSON.stringify(sent.get(projectId)) === JSON.stringify(merged))
      continue;
    if (isEmptyGitInterest(merged)) await clearGitWorkspaceWatch(projectId);
    else await syncGitWorkspaceWatch(merged);
    if (at !== epoch) return;
    sent.set(projectId, merged);
    if (isEmptyGitInterest(merged)) continue;
    // The ping stream resumes from here; read what happened meanwhile. A hint
    // only warms the server: detail is read once a repository is demanded.
    void readGitWorkspace(projectId);
    for (const repo of merged.detail ?? [])
      void readGitRepoDetail(projectId, repo);
  }
});

/** Call from an effect; its reads establish the effect's dependencies. */
export function watchGitWorkspace(
  getInterest: () => GitInterest | undefined,
): () => void {
  const interest = getInterest();
  const token = Symbol();
  if (interest) interests.set(token, interest);
  untrack(() => delivery.schedule());
  return () => {
    interests.delete(token);
    delivery.schedule();
  };
}

/** Imperative demand (outside effects); returns the release function. */
export function holdGitWorkspace(interest: GitInterest): () => void {
  const token = Symbol();
  interests.set(token, interest);
  delivery.schedule();
  return () => {
    interests.delete(token);
    delivery.schedule();
  };
}

// ── Events ──────────────────────────────────────────────────────────────

export function registerGitStoreEvents(): () => void {
  const visibility = () => delivery.schedule();
  document.addEventListener("visibilitychange", visibility);
  const reconnect = onWorkbenchReconnect(() => {
    epoch++;
    snapshotReads.clear();
    detailReads.clear();
    inflightEvents.clear();
    // A restarted daemon owns a new in-memory revision sequence.
    for (const state of Object.values(projects)) {
      state.applied = -1;
      if (state.snapshot) state.snapshot = { ...state.snapshot, revision: -1 };
      for (const [repo, detail] of Object.entries(state.details))
        state.details[repo] = { ...detail, revision: -1 };
    }
    sent.clear();
    delivery.schedule();
    for (const projectId of new SvelteSet(
      [...interests.values()].map((interest) => interest.projectId),
    ))
      void readHeld(projectId);
  });
  const events = onEvent("git.workspace.changed", (event) => {
    const { projectId, revision, repos, detail } = event.data ?? {};
    if (
      typeof projectId !== "string" ||
      typeof revision !== "number" ||
      !Array.isArray(repos) ||
      !Array.isArray(detail)
    )
      return;
    const state = entry(projectId);
    const plan = planEventReads(
      { revision, repos: repos as string[], detail: detail as string[] },
      {
        snapshotRevision: state.snapshot?.revision,
        detailRevisions: Object.fromEntries(
          Object.entries(state.details).map(([repo, held]) => [
            repo,
            held.revision,
          ]),
        ),
      },
    );
    const done = Promise.all([
      plan.snapshot ? readGitWorkspace(projectId) : undefined,
      ...plan.details.map((repo) => readGitRepoDetail(projectId, repo)),
    ]).then(() => {
      state.applied = Math.max(state.applied, revision);
      // Also for pings that changed nothing held (a detail nobody reads).
      notify(projectId);
      if (inflightEvents.get(projectId)?.done === done)
        inflightEvents.delete(projectId);
    }) as Promise<void>;
    const previous = inflightEvents.get(projectId);
    if (!previous || previous.revision <= revision)
      inflightEvents.set(projectId, { revision, done });
  });
  return () => {
    events();
    reconnect();
    document.removeEventListener("visibilitychange", visibility);
  };
}

/**
 * A consumer of Git state outside the Git panel (Files decorations): keeps the
 * project's summaries live and calls `onChange` (debounced) after each change.
 */
export function watchGitChanges(
  projectId: string,
  onChange: () => void,
): () => void {
  const release = holdGitWorkspace({ projectId, visible: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = onGitWorkspaceChange((changed) => {
    if (changed !== projectId) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  });
  return () => {
    clearTimeout(timer);
    stop();
    release();
  };
}
