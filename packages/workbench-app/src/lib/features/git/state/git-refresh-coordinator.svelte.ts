import type { PrResourceState } from "./pr-resource-loader";
import { PrResourceLoader, type PrLoadOptions } from "./pr-resource-loader";
import type {
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
  GithubPrInitial,
  GithubPrListResponse,
  GithubPrOverview,
} from "@nervekit/contracts/git";
import {
  getGithubPrChecks,
  getGithubPrCommits,
  getGithubPrConversation,
  getGithubPrCore,
  getGithubPrFileDiff,
  getGithubPrFiles,
  getGithubPrInitial,
  getGithubPrOverview,
} from "../api/git.api";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { prViewKey } from "$lib/domain/navigation/view-keys";
import { gitState, type PrViewState } from "./git-state.svelte";
import {
  applyPrChecks,
  applyPrCore,
  removeOpenPr,
} from "./git-panel-state.svelte";
import { GIT_STALE_MS, PR_PENDING_POLL_MS } from "./git-refresh-policy";
import { prFileDiffStateKey } from "./pr-file-diff";

export const GIT_RESOURCE_STALE_MS = GIT_STALE_MS;
export const PR_CONVERSATION_STALE_MS = 60_000;
const IMMUTABLE_HEAD_STALE_MS = Number.POSITIVE_INFINITY;

const prResources = new PrResourceLoader({
  queryClient,
  now: Date.now,
  reportError: showCriticalError,
});

export function loadPrInitial(
  view: PrViewState,
  options: PrLoadOptions = {},
): Promise<GithubPrInitial | undefined> {
  const sectionKey = (section: "core" | "conversation" | "overview") =>
    queryKeys.git.prSection(view.projectId, view.repo, view.number, section);
  return prResources.loadInitial({
    key: queryKeys.git.prInitial(view.projectId, view.repo, view.number),
    query: () => getGithubPrInitial(view.projectId, view.repo, view.number),
    staleTime: GIT_RESOURCE_STALE_MS,
    options,
    core: {
      key: sectionKey("core"),
      resource: view.core,
      apply: (core) => applyCore(view, core),
    },
    conversation: {
      key: sectionKey("conversation"),
      resource: view.conversation,
    },
    overview: {
      key: sectionKey("overview"),
      resource: view.overview,
      apply: (overview) => applyOverview(view, overview),
    },
  });
}

type Section = "conversation" | "overview" | "commits" | "checks" | "files";

export function selectedPrFileDiffResource(
  view: PrViewState | undefined,
): PrResourceState<GithubPrFileDiffResponse> | undefined {
  const core = view?.core.data;
  const file = view?.files.data?.files.find(
    (candidate) => candidate.path === view.selectedFilePath,
  );
  if (!view || !core || !file) return undefined;
  return view.fileDiffs[
    prFileDiffStateKey(core.baseRefOid, core.headRefOid, file)
  ];
}

export async function loadPrFileDiff(
  view: PrViewState,
  path: string,
  options?: PrLoadOptions,
): Promise<GithubPrFileDiffResponse | undefined> {
  const core = view.core.data;
  const file = view.files.data?.files.find(
    (candidate) => candidate.path === path,
  );
  if (!core || !file) return undefined;
  const stateKey = prFileDiffStateKey(core.baseRefOid, core.headRefOid, file);
  view.fileDiffs[stateKey] ??= {
    loading: false,
    refreshing: false,
  };
  const resource = view.fileDiffs[stateKey];
  return prResources.load({
    key: queryKeys.git.prFileDiff(
      view.projectId,
      view.repo,
      view.number,
      core.baseRefOid,
      core.headRefOid,
      file.path,
      file.previousPath,
      file.status,
    ),
    query: () =>
      getGithubPrFileDiff({
        projectId: view.projectId,
        repo: view.repo,
        number: view.number,
        path: file.path,
        ...(file.previousPath ? { previousPath: file.previousPath } : {}),
        status: file.status,
        expectedBaseRefOid: core.baseRefOid,
        expectedHeadRefOid: core.headRefOid,
        ...(core.headRepository
          ? { expectedHeadRepository: core.headRepository }
          : {}),
      }),
    staleTime: IMMUTABLE_HEAD_STALE_MS,
    resource,
    options,
  });
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

export async function loadPrCore(
  view: PrViewState,
  options: PrLoadOptions = {},
): Promise<GithubPrCore | undefined> {
  return prResources.load({
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
  options: PrLoadOptions = {},
): Promise<unknown> {
  if (section === "conversation") {
    return prResources.load<GithubPrConversation>({
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
    return prResources.load<GithubPrOverview>({
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
    return prResources.load<GithubPrChecksResponse>({
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

  const baseOid = view.core.data?.baseRefOid;
  const headOid = view.core.data?.headRefOid;
  if (!baseOid || !headOid) return undefined;
  if (section === "commits") {
    return prResources.load<GithubPrCommitsResponse>({
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
  return prResources.load<GithubPrFilesResponse>({
    key: queryKeys.git.prFiles(
      view.projectId,
      view.repo,
      view.number,
      baseOid,
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
      if (view.selectedFilePath)
        void loadPrFileDiff(view, view.selectedFilePath, { silent: true });
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
  if (view.refreshing) return;
  view.refreshing = true;
  view.refreshError = undefined;
  const previousBaseOid = view.core.data?.baseRefOid;
  const previousHeadOid = view.core.data?.headRefOid;
  try {
    await loadPrCore(view, {
      force: true,
      criticalErrorTitle: "Could not refresh pull request",
    });
    const refsChanged =
      Boolean(previousBaseOid && previousHeadOid) &&
      Boolean(view.core.data?.baseRefOid && view.core.data?.headRefOid) &&
      (previousBaseOid !== view.core.data?.baseRefOid ||
        previousHeadOid !== view.core.data?.headRefOid);
    if (refsChanged) {
      view.commits.data = undefined;
      view.commits.error = undefined;
      view.files.data = undefined;
      view.files.error = undefined;
      view.fileDiffs = {};
      view.selectedFilePath = undefined;
    }
    const sections: Section[] =
      view.activeTab === "conversation"
        ? ["conversation", "overview", "checks"]
        : [view.activeTab];
    await Promise.all(
      sections.map((section) =>
        loadPrSection(view, section, {
          force: true,
          criticalErrorTitle: "Could not refresh pull request",
        }),
      ),
    );
    view.refreshError =
      view.core.error ??
      sections.map((section) => view[section].error).find(Boolean);
  } finally {
    view.refreshing = false;
  }
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
