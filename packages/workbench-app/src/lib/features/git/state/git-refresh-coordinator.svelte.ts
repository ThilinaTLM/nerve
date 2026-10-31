import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { PrResourceState } from "./pr-resource-loader";
import {
  PrResourceLoader,
  type PrFeedback,
  type PrLoadOptions,
} from "./pr-resource-loader";
import type {
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
  GithubPrInitial,
  GithubPrSnapshot,
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
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { gitState, type PrViewState } from "./git-state.svelte";
import {
  writePrChecks,
  writePrCore,
  pr,
  refreshPrSnapshot,
  watchPullRequests,
} from "./pr-store.svelte";
import { GIT_STALE_MS } from "./git-refresh-policy";
import { prFileDiffStateKey } from "./pr-file-diff";

export const GIT_RESOURCE_STALE_MS = GIT_STALE_MS;
export const PR_CONVERSATION_STALE_MS = 60_000;
const IMMUTABLE_HEAD_STALE_MS = Number.POSITIVE_INFINITY;

const prResources = new PrResourceLoader({
  queryClient,
  now: Date.now,
  reportError: ({ key, title, message, scope }) =>
    activityInbox.notify({
      key,
      title,
      status: "failed",
      message,
      ...(scope ? { scope } : {}),
    }),
});

/** Activity notice identity with PR context; `operation` groups repeats. */
export function prFeedback(
  view: Pick<PrViewState, "projectId" | "repo" | "number">,
  operation: string,
  action: string,
): PrFeedback {
  return {
    key: `git.pr:${view.projectId}:${view.repo}:${view.number}:${operation}`,
    title: `${action} · ${view.repo === "." ? "" : `${view.repo} `}#${view.number}`,
    scope: { projectId: view.projectId, repositoryPath: view.repo },
  };
}

/** Failures report to Activity by default; `report: false` opts out (aggregates). */
function withFeedback(
  view: Pick<PrViewState, "projectId" | "repo" | "number">,
  operation: string,
  action: string,
  options: PrLoadOptions,
): PrLoadOptions {
  return {
    ...options,
    report:
      options.report === false
        ? undefined
        : (options.report ?? prFeedback(view, operation, action)),
  };
}

export function loadPrInitial(
  view: PrViewState,
  rawOptions: PrLoadOptions = {},
): Promise<GithubPrInitial | undefined> {
  const options = withFeedback(
    view,
    "open",
    "Could not open pull request",
    rawOptions,
  );
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

const staleSections = new SvelteSet<string>();

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
  rawOptions: PrLoadOptions = {},
): Promise<GithubPrFileDiffResponse | undefined> {
  const options = withFeedback(
    view,
    `file:${path}`,
    "Could not load pull request file",
    rawOptions,
  );
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
  writePrCore(view.projectId, view.repo, core);
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
  rawOptions: PrLoadOptions = {},
): Promise<GithubPrCore | undefined> {
  const options = withFeedback(
    view,
    "load",
    "Could not load pull request",
    rawOptions,
  );
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
  rawOptions: PrLoadOptions = {},
): Promise<unknown> {
  if (staleSections.delete(`${view.id}:${section}`))
    rawOptions = { ...rawOptions, force: true };
  const options = withFeedback(
    view,
    `section:${section}`,
    "Could not load pull request section",
    rawOptions,
  );
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
    const headSha = view.core.data?.headRefOid;
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
        writePrChecks(view.projectId, view.repo, view.number, checks, headSha),
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
  await refreshPrSnapshot(view.projectId, view.repo, view.number);
  const previousBaseOid = view.core.data?.baseRefOid;
  const previousHeadOid = view.core.data?.headRefOid;
  try {
    await loadPrCore(view, {
      force: true,
      report: false,
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
          report: false,
        }),
      ),
    );
    // One aggregate notice instead of one per failed resource.
    const message =
      view.core.error ??
      sections.map((section) => view[section].error).find(Boolean);
    if (message)
      activityInbox.notify({
        ...prFeedback(view, "refresh", "Could not refresh pull request"),
        status: "failed",
        message,
      });
  } finally {
    view.refreshing = false;
  }
}

let activePrId = $state<string | undefined>();
let started = false;
let refreshContextOnFocus: (() => void) | undefined;

export function setActivePrRefreshDemand(id: string | undefined): void {
  activePrId = id;
}

function refreshVisibleDemand(): void {
  if (document.visibilityState === "visible") refreshContextOnFocus?.();
}

export function startGitRefreshCoordinator(onFocus?: () => void): () => void {
  if (typeof window === "undefined" || started)
    return stopGitRefreshCoordinator;
  $effect(() => watchPrTabs());
  refreshContextOnFocus = onFocus;
  started = true;
  window.addEventListener("focus", refreshVisibleDemand);
  document.addEventListener("visibilitychange", refreshVisibleDemand);
  return stopGitRefreshCoordinator;
}

export function stopGitRefreshCoordinator(): void {
  if (typeof window === "undefined") return;
  started = false;
  refreshContextOnFocus = undefined;
  window.removeEventListener("focus", refreshVisibleDemand);
  document.removeEventListener("visibilitychange", refreshVisibleDemand);
}

export async function applyMergedPr(view: PrViewState): Promise<void> {
  if (view.core.data) view.core.data = { ...view.core.data, state: "MERGED" };
  if (view.core.data) writePrCore(view.projectId, view.repo, view.core.data);
  await refreshPrSnapshot(view.projectId, view.repo, view.number);
  await queryClient.invalidateQueries({
    queryKey: queryKeys.git.pr(view.projectId, view.repo, view.number),
  });
}

/** Invalidation-driven detail refresh. Hidden resources are made stale, never polled. */
export function reloadChangedPrViews(
  projectId: string,
  repo: string,
  changed: number[],
  previous?: GithubPrSnapshot,
): void {
  for (const view of Object.values(gitState.prViews)) {
    if (
      view.projectId !== projectId ||
      view.repo !== repo ||
      !changed.includes(view.number)
    )
      continue;
    const before = previous?.prs.find((entry) => entry.number === view.number);
    const entity = pr(projectId, repo, view.number);
    const heavyChanged =
      !before ||
      before.headSha !== entity?.headSha ||
      before.updatedAt !== entity?.updatedAt;
    const visible =
      activePrId === view.id && document.visibilityState === "visible";
    if (heavyChanged) {
      for (const section of [
        "conversation",
        "overview",
        "commits",
        "files",
      ] as const) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.git.pr(view.projectId, view.repo, view.number),
        });
        staleSections.add(`${view.id}:${section}`);
      }
    }
    void loadPrCore(view, { force: true, silent: true, report: false }).then(
      () => {
        if (!visible) return;
        void loadPrSection(view, "checks", {
          force: true,
          silent: true,
          report: false,
        });
        if (heavyChanged)
          void loadPrSection(view, view.activeTab, {
            force: true,
            silent: true,
            report: false,
          });
      },
    );
  }
}

export function watchPrTabs(): () => void {
  const groups = new SvelteMap<
    string,
    { projectId: string; repo: string; prs: number[]; activePr?: number }
  >();
  for (const view of Object.values(gitState.prViews)) {
    const scope = JSON.stringify([view.projectId, view.repo]);
    const group = groups.get(scope) ?? {
      projectId: view.projectId,
      repo: view.repo,
      prs: [],
    };
    group.prs.push(view.number);
    if (view.id === activePrId) group.activePr = view.number;
    groups.set(scope, group);
  }
  const cleanups = [...groups.values()].map((group) =>
    watchPullRequests(() => ({
      ...group,
      list: false,
      visible: Boolean(group.activePr),
    })),
  );
  return () => cleanups.forEach((cleanup) => cleanup());
}
