import { SvelteMap, SvelteSet, SvelteURL } from "svelte/reactivity";
import { untrack } from "svelte";
import type {
  GithubPr,
  GithubPrCore,
  GithubChecksSummary,
  GithubPrSnapshot,
} from "@nervekit/contracts/git";
import {
  getGithubPrSnapshot,
  syncGithubPrWatch,
  clearGithubPrWatch,
  refreshGithubPr,
  expectGithubPr,
  listGithubPrs,
} from "../api/git.api";
import { hasActiveGitPrFilters } from "../pr-filters";
import {
  acceptSnapshot,
  mergePrCore,
  filterRepoPrs,
  mergePrInterests,
  selectBranchPr,
  PrWatchDelivery,
  type PrInterest,
  type PrFilters,
} from "./pr-store-model";
import { gitState } from "./git-state.svelte";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";

const key = (projectId: string, repo: string) =>
  JSON.stringify([projectId, repo]);
const repositories = $state<
  Record<
    string,
    {
      snapshot?: GithubPrSnapshot;
      entities: Record<number, GithubPr>;
      loading: boolean;
      refreshing: boolean;
      error?: string;
      expected?: { branch: string; until: number; url?: string };
    }
  >
>({});
const searches = $state<
  Record<string, { loading: boolean; numbers: number[]; error?: string }>
>({});
const interests = new SvelteMap<symbol, PrInterest>();
const sent = new SvelteMap<string, PrInterest>();
let epoch = 0;
const reads = new SvelteMap<string, Promise<void>>();
function state(projectId: string, repo: string) {
  return (repositories[key(projectId, repo)] ??= {
    entities: {},
    loading: false,
    refreshing: false,
  });
}
export function ingestPrSnapshot(snapshot: GithubPrSnapshot): void {
  const entry = state(snapshot.projectId, snapshot.repo);
  const accepted = acceptSnapshot(entry.snapshot, snapshot);
  if (accepted !== snapshot) return;
  entry.snapshot = snapshot;
  const searchNumbers = new SvelteSet(
    Object.entries(searches)
      .filter(([scope]) =>
        scope.startsWith(
          JSON.stringify([snapshot.projectId, snapshot.repo]).slice(0, -1) +
            ",",
        ),
      )
      .flatMap(([, search]) => search.numbers),
  );
  entry.entities = Object.fromEntries([
    ...Object.values(entry.entities)
      .filter((entity) => searchNumbers.has(entity.number))
      .map((entity) => [entity.number, entity]),
    ...snapshot.prs.map((entity) => [entity.number, entity]),
  ]);
  entry.error = undefined;
  publishViews(snapshot.projectId, snapshot.repo);
}
function publishViews(projectId: string, repo: string): void {
  for (const view of Object.values(gitState.prViews)) {
    if (view.projectId !== projectId || view.repo !== repo) continue;
    const entity = pr(projectId, repo, view.number);
    if (entity) {
      view.summary = entity;
      // Seed only: the tab's own checks load carries per-run detail and is
      // reloaded on `github.pr.changed`; summaries must not overwrite it.
      view.checks.data ??= { checks: entity.checks };
    }
  }
}
export function pr(
  projectId: string,
  repo: string,
  number: number,
): GithubPr | undefined {
  return repositories[key(projectId, repo)]?.entities[number];
}
export function writePrCore(
  projectId: string,
  repo: string,
  core: GithubPrCore,
): void {
  const entry = state(projectId, repo);
  const previous = pr(projectId, repo, core.number);
  const summary = mergePrCore(previous, core);
  entry.entities[core.number] = summary;
  if (entry.snapshot)
    entry.snapshot.prs = entry.snapshot.prs.map((entity) =>
      entity.number === core.number ? summary : entity,
    );
  publishViews(projectId, repo);
}
export function writePrChecks(
  projectId: string,
  repo: string,
  number: number,
  checks: GithubChecksSummary,
  headSha?: string,
): void {
  const entity = pr(projectId, repo, number);
  if (entity && (!headSha || entity.headSha === headSha)) {
    entity.checks = checks;
    publishViews(projectId, repo);
  }
}
export function branchPr(
  projectId: string,
  repo: string,
  branch?: string | null,
) {
  return selectBranchPr(
    Object.values(repositories[key(projectId, repo)]?.entities ?? {}),
    branch,
  );
}
export function repoPrStatus(projectId: string, repo: string) {
  const entry = repositories[key(projectId, repo)];
  return {
    loading: entry?.loading ?? false,
    refreshing: entry?.refreshing ?? false,
    status: entry?.snapshot?.status ?? "stale",
    retryAt: entry?.snapshot?.retryAt,
    error: entry?.error,
  };
}
export function repoPrRepositoryUrl(
  projectId: string,
  repo: string,
): string | undefined {
  return (
    repositories[key(projectId, repo)]?.snapshot?.repositoryUrl ?? undefined
  );
}
export function repoPrHeads(projectId: string, repo: string) {
  const snapshot = repositories[key(projectId, repo)]?.snapshot;
  return snapshot
    ? {
        repository: snapshot.repositoryUrl
          ? new SvelteURL(snapshot.repositoryUrl).pathname.slice(1)
          : "",
        prs: snapshot.prs.filter((pr) => pr.state === "OPEN"),
      }
    : undefined;
}
export function repoPrs(
  projectId: string,
  repo: string,
  filters: PrFilters,
  branch?: string | null,
): GithubPr[] {
  const snapshot = repositories[key(projectId, repo)]?.snapshot;
  if (!snapshot) return [];
  if (snapshot.truncated && (hasActiveGitPrFilters(filters) || filters.head)) {
    const searchKey = JSON.stringify([projectId, repo, filters, branch]);
    const search = searches[searchKey];
    if (!search)
      untrack(() => {
        searches[searchKey] = { loading: true, numbers: [] };
        void searchPrs(searchKey, projectId, repo, filters, branch);
      });
    return (search?.numbers ?? []).flatMap((number) => {
      const entity = pr(projectId, repo, number);
      return entity ? [entity] : [];
    });
  }
  return filterRepoPrs(snapshot.prs, filters, snapshot.viewer, branch);
}
async function searchPrs(
  searchKey: string,
  projectId: string,
  repo: string,
  filters: PrFilters,
  branch?: string | null,
) {
  try {
    const result = await listGithubPrs(projectId, repo, {
      ...filters,
      author: filters.author,
      username: filters.author === "username" ? filters.username : undefined,
      labels: [...filters.labels],
      head:
        filters.head ??
        (filters.currentBranchOnly ? (branch ?? undefined) : undefined),
    });
    const entry = state(projectId, repo);
    for (const entity of result.prs)
      if (!pr(projectId, repo, entity.number))
        entry.entities[entity.number] = entity;
    searches[searchKey] = {
      loading: false,
      numbers: result.prs.map((pr) => pr.number),
    };
  } catch (error) {
    searches[searchKey] = { loading: false, numbers: [], error: String(error) };
  }
}
export function readPrSnapshot(projectId: string, repo: string): Promise<void> {
  const scope = key(projectId, repo);
  const existing = reads.get(scope);
  if (existing) return existing;
  const entry = state(projectId, repo);
  entry.loading = !entry.snapshot;
  const requestEpoch = epoch;
  const request = getGithubPrSnapshot(projectId, repo)
    .then((snapshot) => {
      if (requestEpoch === epoch) ingestPrSnapshot(snapshot);
    })
    .catch((error: unknown) => {
      entry.error = String(error);
    })
    .finally(() => {
      entry.loading = false;
      if (reads.get(scope) === request) reads.delete(scope);
    });
  reads.set(scope, request);
  return request;
}
export async function refreshPrSnapshot(
  projectId: string,
  repo: string,
  number?: number,
): Promise<void> {
  const entry = state(projectId, repo);
  entry.refreshing = true;
  try {
    ingestPrSnapshot(await refreshGithubPr(projectId, repo, number));
  } catch (error) {
    entry.error = String(error);
  } finally {
    entry.refreshing = false;
  }
}
export async function expectPr(
  projectId: string,
  repo: string,
  branch: string,
  url?: string,
): Promise<void> {
  const result = await expectGithubPr(projectId, repo, branch);
  if (result.accepted)
    state(projectId, repo).expected = {
      branch,
      until: Date.now() + 600_000,
      url,
    };
}
export function awaitingPr(
  projectId: string,
  repo: string,
  branch?: string | null,
): boolean {
  const expected = repositories[key(projectId, repo)]?.expected;
  return Boolean(
    expected &&
    expected.branch === branch &&
    expected.until > Date.now() &&
    !branchPr(projectId, repo, branch),
  );
}
const delivery = new PrWatchDelivery(async () => {
  const deliveryEpoch = epoch;
  const scopes = new SvelteMap<string, PrInterest[]>();
  for (const interest of interests.values()) {
    const scope = key(interest.projectId, interest.repo);
    scopes.set(scope, [...(scopes.get(scope) ?? []), interest]);
  }
  for (const [scope, old] of sent)
    if (!scopes.has(scope)) {
      await clearGithubPrWatch(old.projectId, old.repo);
      sent.delete(scope);
    }
  for (const [scope, local] of scopes) {
    const merged = mergePrInterests(
      local,
      typeof document === "undefined" || document.visibilityState === "visible",
    )!;
    if (JSON.stringify(sent.get(scope)) === JSON.stringify(merged)) continue;
    await syncGithubPrWatch(merged);
    if (deliveryEpoch !== epoch) return;
    sent.set(scope, merged);
    await readPrSnapshot(merged.projectId, merged.repo);
  }
});
/** Call from an effect; its reads establish the effect's dependencies. */
export function watchPullRequests(
  getInterest: () => PrInterest | undefined,
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
export function registerPrStoreEvents(): () => void {
  const visibility = () => delivery.schedule();
  document.addEventListener("visibilitychange", visibility);
  const reconnect = onWorkbenchReconnect(() => {
    epoch++;
    reads.clear();
    // A restarted daemon owns a new in-memory revision sequence.
    for (const entry of Object.values(repositories))
      if (entry.snapshot) entry.snapshot = { ...entry.snapshot, revision: -1 };
    sent.clear();
    delivery.schedule();
    for (const interest of interests.values())
      void readPrSnapshot(interest.projectId, interest.repo);
  });
  const events = onEvent("github.pr.changed", (event) => {
    void (async () => {
      const { projectId, repo, changed, checksChanged } = event.data ?? {};
      if (
        typeof projectId !== "string" ||
        typeof repo !== "string" ||
        !Array.isArray(changed) ||
        !changed.every((number) => typeof number === "number")
      )
        return;
      const before = repositories[key(projectId, repo)]?.snapshot;
      await readPrSnapshot(projectId, repo);
      const revision = event.data?.revision;
      if (
        typeof revision === "number" &&
        (repositories[key(projectId, repo)]?.snapshot?.revision ?? -1) <
          revision
      )
        await readPrSnapshot(projectId, repo);
      const { reloadChangedPrViews } =
        await import("./git-refresh-coordinator.svelte");
      reloadChangedPrViews(
        projectId,
        repo,
        [
          ...new SvelteSet([
            ...changed,
            ...(Array.isArray(checksChanged)
              ? checksChanged.filter(
                  (number): number is number => typeof number === "number",
                )
              : []),
          ]),
        ],
        before,
      );
    })();
  });
  return () => {
    events();
    reconnect();
    document.removeEventListener("visibilitychange", visibility);
  };
}

export function expectedPrUrl(
  projectId: string,
  repo: string,
): string | undefined {
  return repositories[key(projectId, repo)]?.expected?.url;
}
