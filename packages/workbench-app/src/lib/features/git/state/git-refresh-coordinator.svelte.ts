import type {
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFilesResponse,
  GithubPrListResponse,
  GithubPrOverview,
} from "$lib/api";
import {
  getGithubPrChecks,
  getGithubPrCommits,
  getGithubPrConversation,
  getGithubPrCore,
  getGithubPrFiles,
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
    input.resource.data = data;
    input.resource.error = undefined;
    input.apply?.(data);
    return data;
  } catch (error) {
    if (!input.options?.silent || !hadData)
      input.resource.error = message(error);
    return undefined;
  } finally {
    input.resource.loading = false;
    input.resource.refreshing = false;
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
    apply: (core) => {
      applyPrCore(view.projectId, view.repo, core);
      const allowed = view.overview.data?.mergeSettings.allowedMethods ?? [];
      if (
        !view.selectedMergeMethod ||
        !allowed.includes(view.selectedMergeMethod)
      ) {
        view.selectedMergeMethod = (
          ["merge", "squash", "rebase"] as const
        ).find((method) => allowed.includes(method));
      }
    },
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
      apply: (overview) => {
        const allowed = overview.mergeSettings.allowedMethods;
        if (
          !view.selectedMergeMethod ||
          !allowed.includes(view.selectedMergeMethod)
        ) {
          view.selectedMergeMethod = (
            ["merge", "squash", "rebase"] as const
          ).find((method) => allowed.includes(method));
        }
      },
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
  if (view?.checks.data?.checks.status === "pending") {
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
