import { SvelteMap } from "svelte/reactivity";
import type {
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFilesResponse,
  GithubPrInitial,
  GithubPrListResponse,
  GithubPrOverview,
} from "$lib/api";
import {
  getGithubPrChecks,
  getGithubPrCommits,
  getGithubPrConversation,
  getGithubPrCore,
  getGithubPrFiles,
  getGithubPrInitial,
  getGithubPrOverview,
} from "$lib/api";
import { queryClient, queryKeys } from "$lib/core/query";
import { prViewKey } from "$lib/core/state/state-keys";
import {
  gitState,
  type PrResourceState,
  type PrViewState,
} from "./git-state.svelte";
import {
  applyPrChecks,
  applyPrCore,
  removeOpenPr,
} from "./git-panel-state.svelte";
import { GIT_STALE_MS, PR_PENDING_POLL_MS } from "./git-refresh-policy";

export const GIT_RESOURCE_STALE_MS = GIT_STALE_MS;
export const PR_CONVERSATION_STALE_MS = 60_000;
const IMMUTABLE_HEAD_STALE_MS = Number.POSITIVE_INFINITY;

type LoadOptions = { force?: boolean; silent?: boolean };
type Section = "conversation" | "overview" | "commits" | "checks" | "files";

const resourceRequests = new SvelteMap<string, Promise<unknown>>();
const resourceVersions = new SvelteMap<string, number>();

function claimResource(key: readonly unknown[]): number {
  const requestKey = JSON.stringify(key);
  const version = (resourceVersions.get(requestKey) ?? 0) + 1;
  resourceVersions.set(requestKey, version);
  return version;
}

function ownsResource(key: readonly unknown[], version: number): boolean {
  return resourceVersions.get(JSON.stringify(key)) === version;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchResource<T>(input: {
  key: readonly unknown[];
  query: () => Promise<T>;
  staleTime: number;
  resource: PrResourceState<T>;
  options?: LoadOptions;
  apply?: (data: T) => void;
}): Promise<T | undefined> {
  const requestKey = JSON.stringify(input.key);
  const existing = resourceRequests.get(requestKey) as
    | Promise<T | undefined>
    | undefined;
  if (existing) return existing;

  const version = claimResource(input.key);
  if (!input.options?.force) {
    const queryState = queryClient.getQueryState<T>(input.key);
    const cached = queryClient.getQueryData<T>(input.key);
    if (
      cached !== undefined &&
      queryState?.dataUpdatedAt !== undefined &&
      Date.now() - queryState.dataUpdatedAt < input.staleTime
    ) {
      if (ownsResource(input.key, version) && input.resource.data !== cached) {
        input.resource.data = cached;
        input.resource.error = undefined;
        input.apply?.(cached);
      }
      return cached;
    }
  }

  const request = (async (): Promise<T | undefined> => {
    const hadData = input.resource.data !== undefined;
    input.resource.loading = !hadData;
    input.resource.refreshing = hadData;
    if (!input.options?.silent) input.resource.error = undefined;
    try {
      if (input.options?.force) {
        await queryClient.invalidateQueries({ queryKey: input.key });
      }
      const data = await queryClient.fetchQuery({
        queryKey: input.key,
        queryFn: input.query,
        staleTime: input.staleTime,
      });
      if (ownsResource(input.key, version)) {
        if (input.resource.data !== data) {
          input.resource.data = data;
          input.apply?.(data);
        }
        input.resource.error = undefined;
      }
      return data;
    } catch (error) {
      if (
        ownsResource(input.key, version) &&
        (!input.options?.silent || !hadData)
      )
        input.resource.error = message(error);
      return undefined;
    } finally {
      if (ownsResource(input.key, version)) {
        input.resource.loading = false;
        input.resource.refreshing = false;
      }
    }
  })();
  resourceRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (resourceRequests.get(requestKey) === request)
      resourceRequests.delete(requestKey);
  }
}

function prSectionKey(
  view: PrViewState,
  section: "core" | "conversation" | "overview",
): readonly unknown[] {
  return queryKeys.git.prSection(
    view.projectId,
    view.repo,
    view.number,
    section,
  );
}

function applyCore(view: PrViewState, core: GithubPrCore): void {
  applyPrCore(view.projectId, view.repo, core);
  selectAllowedMergeMethod(view);
}

function applyOverview(view: PrViewState, overview: GithubPrOverview): void {
  selectAllowedMergeMethod(view, overview.mergeSettings.allowedMethods);
}

function selectAllowedMergeMethod(
  view: PrViewState,
  allowed = view.overview.data?.mergeSettings.allowedMethods ?? [],
): void {
  if (
    !view.selectedMergeMethod ||
    !allowed.includes(view.selectedMergeMethod)
  ) {
    view.selectedMergeMethod = (["merge", "squash", "rebase"] as const).find(
      (method) => allowed.includes(method),
    );
  }
}

function hydrateInitialSection<T>(input: {
  key: readonly unknown[];
  version: number;
  initialUpdatedAt: number;
  resource: PrResourceState<T>;
  data: T;
  apply?: (data: T) => void;
}): void {
  if (!ownsResource(input.key, input.version)) return;
  const sectionUpdatedAt =
    queryClient.getQueryState<T>(input.key)?.dataUpdatedAt ?? 0;
  if (sectionUpdatedAt > input.initialUpdatedAt) return;
  const cached =
    queryClient.setQueryData<T>(input.key, input.data) ?? input.data;
  if (input.resource.data !== cached) {
    input.resource.data = cached;
    input.apply?.(cached);
  }
  input.resource.error = undefined;
}

export async function loadPrInitial(
  view: PrViewState,
  options: LoadOptions = {},
): Promise<GithubPrInitial | undefined> {
  const initialKey = queryKeys.git.prInitial(
    view.projectId,
    view.repo,
    view.number,
  );
  const requestKey = JSON.stringify(initialKey);
  const existing = resourceRequests.get(requestKey) as
    | Promise<GithubPrInitial | undefined>
    | undefined;
  if (existing) return existing;

  const coreKey = prSectionKey(view, "core");
  const conversationKey = prSectionKey(view, "conversation");
  const overviewKey = prSectionKey(view, "overview");
  const versions = {
    core: claimResource(coreKey),
    conversation: claimResource(conversationKey),
    overview: claimResource(overviewKey),
  };
  const applyInitial = (data: GithubPrInitial): void => {
    const initialUpdatedAt =
      queryClient.getQueryState<GithubPrInitial>(initialKey)?.dataUpdatedAt ??
      Date.now();
    hydrateInitialSection({
      key: coreKey,
      version: versions.core,
      initialUpdatedAt,
      resource: view.core,
      data: data.core,
      apply: (core) => applyCore(view, core),
    });
    hydrateInitialSection({
      key: conversationKey,
      version: versions.conversation,
      initialUpdatedAt,
      resource: view.conversation,
      data: data.conversation,
    });
    hydrateInitialSection({
      key: overviewKey,
      version: versions.overview,
      initialUpdatedAt,
      resource: view.overview,
      data: data.overview,
      apply: (overview) => applyOverview(view, overview),
    });
  };

  if (!options.force) {
    const queryState = queryClient.getQueryState<GithubPrInitial>(initialKey);
    const cached = queryClient.getQueryData<GithubPrInitial>(initialKey);
    if (
      cached !== undefined &&
      queryState?.dataUpdatedAt !== undefined &&
      Date.now() - queryState.dataUpdatedAt < GIT_RESOURCE_STALE_MS
    ) {
      applyInitial(cached);
      return cached;
    }
  }

  const resources = [view.core, view.conversation, view.overview] as const;
  for (const resource of resources) {
    const hadData = resource.data !== undefined;
    resource.loading = !hadData;
    resource.refreshing = hadData;
    if (!options.silent) resource.error = undefined;
  }

  const request = (async (): Promise<GithubPrInitial | undefined> => {
    try {
      if (options.force)
        await queryClient.invalidateQueries({ queryKey: initialKey });
      const data = await queryClient.fetchQuery({
        queryKey: initialKey,
        queryFn: () =>
          getGithubPrInitial(view.projectId, view.repo, view.number),
        staleTime: GIT_RESOURCE_STALE_MS,
      });
      applyInitial(data);
      return data;
    } catch (error) {
      const errorMessage = message(error);
      for (const [resource, key, version] of [
        [view.core, coreKey, versions.core],
        [view.conversation, conversationKey, versions.conversation],
        [view.overview, overviewKey, versions.overview],
      ] as const) {
        if (
          ownsResource(key, version) &&
          (!options.silent || resource.data === undefined)
        )
          resource.error = errorMessage;
      }
      return undefined;
    } finally {
      for (const [resource, key, version] of [
        [view.core, coreKey, versions.core],
        [view.conversation, conversationKey, versions.conversation],
        [view.overview, overviewKey, versions.overview],
      ] as const) {
        if (ownsResource(key, version)) {
          resource.loading = false;
          resource.refreshing = false;
        }
      }
    }
  })();
  resourceRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (resourceRequests.get(requestKey) === request)
      resourceRequests.delete(requestKey);
  }
}

export async function loadPrCore(
  view: PrViewState,
  options: LoadOptions = {},
): Promise<GithubPrCore | undefined> {
  return fetchResource({
    key: queryKeys.git.prSection(
      view.projectId,
      view.repo,
      view.number,
      "core",
    ),
    query: () => getGithubPrCore(view.projectId, view.repo, view.number),
    staleTime: GIT_RESOURCE_STALE_MS,
    resource: view.core,
    options,
    apply: (core) => applyCore(view, core),
  });
}

export async function loadPrSection(
  view: PrViewState,
  section: Section,
  options: LoadOptions = {},
): Promise<unknown> {
  if (section === "conversation") {
    return fetchResource<GithubPrConversation>({
      key: queryKeys.git.prSection(
        view.projectId,
        view.repo,
        view.number,
        "conversation",
      ),
      query: () =>
        getGithubPrConversation(view.projectId, view.repo, view.number),
      staleTime: PR_CONVERSATION_STALE_MS,
      resource: view.conversation,
      options,
    });
  }
  if (section === "overview") {
    return fetchResource<GithubPrOverview>({
      key: queryKeys.git.prSection(
        view.projectId,
        view.repo,
        view.number,
        "overview",
      ),
      query: () => getGithubPrOverview(view.projectId, view.repo, view.number),
      staleTime: GIT_RESOURCE_STALE_MS,
      resource: view.overview,
      options,
      apply: (overview) => applyOverview(view, overview),
    });
  }
  if (section === "checks") {
    return fetchResource<GithubPrChecksResponse>({
      key: queryKeys.git.prSection(
        view.projectId,
        view.repo,
        view.number,
        "checks",
      ),
      query: () => getGithubPrChecks(view.projectId, view.repo, view.number),
      staleTime:
        view.checks.data?.checks.status === "pending"
          ? 0
          : GIT_RESOURCE_STALE_MS,
      resource: view.checks,
      options,
      apply: ({ checks }) =>
        applyPrChecks(view.projectId, view.repo, view.number, checks),
    });
  }

  const headOid = view.core.data?.headRefOid;
  if (!headOid) return undefined;
  if (section === "commits") {
    return fetchResource<GithubPrCommitsResponse>({
      key: queryKeys.git.prHeadSection(
        view.projectId,
        view.repo,
        view.number,
        "commits",
        headOid,
      ),
      query: () => getGithubPrCommits(view.projectId, view.repo, view.number),
      staleTime: IMMUTABLE_HEAD_STALE_MS,
      resource: view.commits,
      options,
    });
  }
  return fetchResource<GithubPrFilesResponse>({
    key: queryKeys.git.prHeadSection(
      view.projectId,
      view.repo,
      view.number,
      "files",
      headOid,
    ),
    query: () => getGithubPrFiles(view.projectId, view.repo, view.number),
    staleTime: IMMUTABLE_HEAD_STALE_MS,
    resource: view.files,
    options,
    apply: (files) => {
      if (
        !view.selectedFilePath ||
        !files.files.some((file) => file.path === view.selectedFilePath)
      ) {
        view.selectedFilePath = files.files[0]?.path;
      }
    },
  });
}

export function demandPrTab(view: PrViewState): void {
  if (view.activeTab === "conversation") {
    void Promise.all([
      loadPrSection(view, "conversation", { silent: true }),
      loadPrSection(view, "overview", { silent: true }),
      ...(view.checks.data
        ? []
        : [loadPrSection(view, "checks", { silent: true })]),
    ]);
    return;
  }
  void loadPrSection(view, view.activeTab, { silent: true });
}

export async function refreshCurrentPr(view: PrViewState): Promise<void> {
  const sections: Section[] =
    view.activeTab === "conversation"
      ? ["conversation", "overview", "checks"]
      : [view.activeTab];
  await Promise.all([
    loadPrCore(view, { force: true }),
    ...sections.map((section) => loadPrSection(view, section, { force: true })),
  ]);
}

let activePrId: string | undefined;
let timer: number | undefined;
let refreshContextOnFocus: (() => void) | undefined;

export function setActivePrRefreshDemand(id: string | undefined): void {
  activePrId = id;
}

function pollActivePr(): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible")
    return;
  const view = activePrId ? gitState.prViews[prViewKey(activePrId)] : undefined;
  if (
    view?.checks.data?.checks.status === "pending" &&
    !view.checks.loading &&
    !view.checks.refreshing
  ) {
    void loadPrSection(view, "checks", { force: true, silent: true });
  }
}

function refreshVisibleDemand(): void {
  pollActivePr();
  if (document.visibilityState === "visible") refreshContextOnFocus?.();
}

export function startGitRefreshCoordinator(onFocus?: () => void): () => void {
  if (typeof window === "undefined" || timer !== undefined)
    return stopGitRefreshCoordinator;
  refreshContextOnFocus = onFocus;
  timer = window.setInterval(pollActivePr, PR_PENDING_POLL_MS);
  window.addEventListener("focus", refreshVisibleDemand);
  document.addEventListener("visibilitychange", refreshVisibleDemand);
  return stopGitRefreshCoordinator;
}

export function stopGitRefreshCoordinator(): void {
  if (typeof window === "undefined") return;
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  refreshContextOnFocus = undefined;
  window.removeEventListener("focus", refreshVisibleDemand);
  document.removeEventListener("visibilitychange", refreshVisibleDemand);
}

export async function applyMergedPr(view: PrViewState): Promise<void> {
  if (view.core.data) view.core.data = { ...view.core.data, state: "MERGED" };
  removeOpenPr(view.projectId, view.repo, view.number);
  const prefix = ["git", view.projectId, "repo", view.repo, "prs"] as const;
  for (const [key, data] of queryClient.getQueriesData<GithubPrListResponse>({
    queryKey: prefix,
  })) {
    if (data) {
      queryClient.setQueryData(key, {
        ...data,
        prs: data.prs.filter((pr) => pr.number !== view.number),
      });
    }
  }
  await queryClient.invalidateQueries({
    queryKey: queryKeys.git.pr(view.projectId, view.repo, view.number),
  });
  await queryClient.invalidateQueries({ queryKey: prefix });
}
