import {
  repoPrs,
  repoPrHeads,
  repoPrRepositoryUrl,
  branchPr,
  repoPrStatus,
  watchPullRequests,
  refreshPrSnapshot,
  readPrSnapshot,
  awaitingPr,
  expectPr,
  expectedPrUrl,
} from "./pr-store.svelte";
import { untrack } from "svelte";
import { gitProjectView } from "./git-panel-view-state.svelte";
import { isPrimaryWorktree, worktreeGroupOf } from "../views/git-repo-tree";
import { lastRemoteFailure } from "../views/git-remote-actions";
import { createGitPanelActions } from "../views/git-panel-controller";
import { startBulkGitOperation, cancelGitOperation } from "../api/git.api";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  gitRemoteBusy,
  gitRunningOperations,
  observeBulkGitOperationStart,
} from "./git-operation-tracking";
import {
  disabledCapability,
  enabledCapability,
  type GitPanelActions,
  type GitPanelModel,
  type GitRemoteOperation,
} from "../views/git-panel-types";
import { defaultGitPrFilterConfig } from "../pr-filters";
import {
  githubCheckoutGroups,
  pullRequestsOverview,
} from "./pr-panel-sources.svelte";
import {
  prPanelPreferences,
  setPrPanelFilters,
  setPrPanelQuickFilter,
} from "./pr-panel-state.svelte";
import type { Project } from "@nervekit/contracts/core";
import type {
  GitOperationBulkStartRequest,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import { openDiffPane } from "$lib/features/git/state/diff-tabs.svelte";
import { openPrPane } from "$lib/features/git/state/pr-tabs.svelte";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/domain/navigation/view-keys";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { shouldActivateGitPanel } from "./git-startup-policy";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { gitPanelLayout } from "./git-panel-view-state.svelte";
import {
  gitHintedRepo,
  gitRepoDetail,
  gitRepoDetailLoading,
  gitWorkspaceSnapshot,
  gitWorkspaceStatus,
  hintGitRepo,
  readGitRepoDetail,
  readGitWorkspace,
  refreshGitWorkspaceNow,
  watchGitWorkspace,
} from "./git-store.svelte";
import {
  applyGitRepoStash,
  createGitRepoBranch,
  createGitRepoStash,
  deleteGitRepoBranch,
  fetchGitRepo,
  dropGitRepoStash,
  gitPanelState,
  errorMessage,
  mutateGitFile,
  mutateGitFileScope,
  pullGitRepo,
  pushGitRepo,
  refreshBranches,
  refreshGithub,
  selectedGitRepo,
  setGitChangeTreeFolderExpanded,
  selectGitRepo,
  switchBaseAndPullGitRepo,
  switchGitRepoBranch,
  syncGitRepo,
} from "./git-panel.svelte";

const unsupported = disabledCapability(
  "Select a project to use Git operations.",
);
const emptyCollapsedFolders: ReadonlySet<string> = new Set();
const noRepositories: readonly GitRepoSummary[] = [];
const emptyPullRequestsOverview: GitPanelModel["pullRequestsOverview"] = {
  repositoryCount: 0,
  sources: [],
  status: "loading",
  viewer: null,
  loading: false,
  refreshing: false,
};

export function createWorkbenchGitPanelAdapter(
  activeProject: () => Project | undefined,
  enabled: () => boolean = () => true,
  pullRequestsEnabled: () => boolean = enabled,
): { readonly model: GitPanelModel; readonly actions: GitPanelActions } {
  const adapter = {
    get model(): GitPanelModel {
      const project = activeProject();
      const projectState = project
        ? gitPanelState.projects[gitProjectStateKey(project.id)]
        : undefined;
      const snapshot = project ? gitWorkspaceSnapshot(project.id) : undefined;
      const workspace = project ? gitWorkspaceStatus(project.id) : undefined;
      const repositories = snapshot?.summaries ?? noRepositories;
      const selectedRepository = project ? selectedGitRepo(project.id) : ".";
      const current =
        projectState?.repoStates[gitRepoStateKey(selectedRepository)];
      const detail = project
        ? gitRepoDetail(project.id, selectedRepository)
        : undefined;
      // Summaries already describe every repository, so the branch line and
      // branch-scoped PR state render at once while the detail loads.
      const repositorySummary = repositories.find(
        (repo) => repo.relativePath === selectedRepository,
      );
      const prefs = project
        ? prPanelPreferences(project.id)
        : { quick: "all" as const, filters: defaultGitPrFilterConfig };
      const capabilities = project
        ? {
            refresh: enabledCapability,
            selectRepository: enabledCapability,
            branches: enabledCapability,
            mutateFiles: enabledCapability,
            bulkMutateFiles: enabledCapability,
            stashes: enabledCapability,
            remote: {
              fetch: enabledCapability,
              pull: enabledCapability,
              push: enabledCapability,
              sync: enabledCapability,
              "switch-base-and-pull": enabledCapability,
            },
            openPullRequest: enabledCapability,
          }
        : {
            refresh: unsupported,
            selectRepository: unsupported,
            branches: unsupported,
            mutateFiles: unsupported,
            bulkMutateFiles: unsupported,
            stashes: unsupported,
            remote: {
              fetch: unsupported,
              pull: unsupported,
              push: unsupported,
              sync: unsupported,
              "switch-base-and-pull": unsupported,
            },
            openPullRequest: unsupported,
          };
      return {
        projectId: project?.id,
        availability: project
          ? { available: true }
          : {
              available: false,
              message: "Select a project to inspect its Git repositories.",
            },
        emptyMessage:
          "No Git repositories found in this directory (searched up to 2 levels deep).",
        repositories,
        selectedRepository,
        repositorySummary,
        changes: detail,
        branches: current?.branches ?? [],
        collapsedChangeTreeFolders:
          current?.collapsedChangeTreeFolders ?? emptyCollapsedFolders,
        stashes: detail?.stashes ?? [],
        github: current?.github,
        pullRequests: project
          ? repoPrs(project.id, selectedRepository, prefs.filters)
          : [],
        prHeads: project
          ? repoPrHeads(project.id, selectedRepository)
          : undefined,
        currentBranchPr: project
          ? branchPr(
              project.id,
              selectedRepository,
              repositorySummary?.currentBranch,
            )
          : undefined,
        awaitingPullRequest: project
          ? awaitingPr(
              project.id,
              selectedRepository,
              repositorySummary?.currentBranch,
            )
          : false,
        expectedPullRequestUrl: project
          ? expectedPrUrl(project.id, selectedRepository)
          : undefined,
        pullRequestFilters: prefs.filters,
        pullRequestQuickFilter: prefs.quick,
        pullRequestsOverview: project
          ? pullRequestsOverview(project.id, repositories)
          : emptyPullRequestsOverview,
        initialLoading:
          Boolean(project) && !snapshot?.loaded && !workspace?.error,
        cachedError: snapshot?.loaded ? undefined : workspace?.error,
        readErrors: snapshot?.errors,
        stale: Boolean(
          snapshot?.staleRepos.includes(selectedRepository) || detail?.stale,
        ),
        refreshing:
          Boolean(workspace?.refreshing) ||
          Boolean(
            project && repoPrStatus(project.id, selectedRepository).refreshing,
          ),
        loadingOverview: project
          ? gitRepoDetailLoading(project.id, selectedRepository)
          : false,
        loadingBranches: current?.loadingBranches ?? false,
        loadingPullRequests: project
          ? repoPrStatus(project.id, selectedRepository).loading ||
            repoPrStatus(project.id, selectedRepository).refreshing
          : false,
        loadingPrHeads: project
          ? repoPrStatus(project.id, selectedRepository).loading
          : false,
        pullRequestError: project
          ? prNotice(project.id, selectedRepository)
          : undefined,
        activeOperations: project
          ? gitRunningOperations(activityInbox.activities, project.id)
          : [],
        operations: {
          ...(current?.operations ?? { creatingBranch: false }),
          ...gitRemoteBusy(
            activityInbox.activities,
            project?.id ?? "",
            selectedRepository,
          ),
        },
        capabilities,
        branchPullRequest: (repository: string) =>
          project
            ? branchPr(
                project.id,
                repository,
                repositories.find((repo) => repo.relativePath === repository)
                  ?.currentBranch,
              )
            : undefined,
        lastRemoteFailure: (repository: string) =>
          lastRemoteFailure(
            activityInbox.activities.filter(
              (activity) => activity.scope?.projectId === project?.id,
            ),
            repository,
          ),
        repoBranchState: (repository: string) => {
          const state = projectState?.repoStates[gitRepoStateKey(repository)];
          return {
            repoSummary: repositories.find(
              (repo) => repo.relativePath === repository,
            ),
            branches: state?.branches ?? [],
            repositoryUrl: project
              ? repoPrRepositoryUrl(project.id, repository)
              : undefined,
            prHeads: project ? repoPrHeads(project.id, repository) : undefined,
            loadingBranches: state?.loadingBranches ?? false,
            loadingPrHeads: project
              ? repoPrStatus(project.id, repository).loading
              : false,
            switchingBranch: state?.operations?.switchingBranch,
          };
        },
      };
    },
    actions: undefined as unknown as GitPanelActions,
  };

  const host: GitPanelActions = {
    runBulkRemoteOperation: async (kind) => {
      const project = activeProject();
      if (!project) return;
      // Fetch and "switch to base" act once per repository, on its primary
      // checkout; pull runs in every worktree.
      const repos = adapter.model.repositories
        .filter(
          (repo) =>
            repo.hasRemote && (kind === "pull" || isPrimaryWorktree(repo)),
        )
        .map((repo) => repo.relativePath);
      if (!repos.length) return;
      try {
        const input = {
          projectId: project.id,
          repos,
          kind: kind === "switch-base-and-pull" ? "switchBaseAndPull" : kind,
        } satisfies GitOperationBulkStartRequest;
        const result = await startBulkGitOperation(input);
        observeBulkGitOperationStart(activityInbox, input, result);
      } catch {
        notify.error("Could not start bulk Git operation");
      }
    },
    retryOperation: (operationId) => activityInbox.action("retry", operationId),
    dismissOperation: (operationId) =>
      activityInbox.action("dismiss", operationId),
    cancelOperation: async (operationId) => {
      try {
        const result = await cancelGitOperation(operationId);
        if (!result.accepted)
          notify.error(result.reason ?? "Operation is no longer cancellable");
      } catch {
        notify.error("Could not cancel Git operation");
      }
    },
    refreshAll: async () => {
      const project = activeProject();
      if (!project) return;
      try {
        await refreshGitWorkspaceNow(project.id);
      } catch (error) {
        showCriticalError(
          "Could not refresh Git repositories",
          errorMessage(error),
        );
      }
    },
    refreshRepository: async (repository) => {
      const project = activeProject();
      if (!project) return;
      await Promise.all([
        refreshGitWorkspaceNow(project.id, repository).catch((error) =>
          showCriticalError(
            "Could not refresh repository",
            errorMessage(error),
          ),
        ),
        refreshGithub(
          project.id,
          repository,
          true,
          "Could not refresh repository",
        ),
      ]);
    },
    loadStashes: async (repository) => {
      const project = activeProject();
      if (!project) return;
      await readGitRepoDetail(project.id, repository);
      if (activeProject()?.id !== project.id) return;
      const detail = gitRepoDetail(project.id, repository);
      if (!detail) notify.error("Could not load stashes");
      return detail?.stashes;
    },
    refreshBranches: (repository) => {
      const project = activeProject();
      if (project)
        return refreshBranches(
          project.id,
          repository,
          "Could not refresh branches",
          true,
        );
    },
    expectPullRequest: (repository, branch, url) => {
      const project = activeProject();
      if (project)
        void expectPr(project.id, repository, branch, url).catch(
          () => undefined,
        );
    },
    loadPullRequestBadges: (repository) => {
      const project = activeProject();
      if (project) return readPrSnapshot(project.id, repository);
    },
    refreshPullRequests: async (repository) => {
      const project = activeProject();
      if (project) await refreshPrSnapshot(project.id, repository);
    },
    configurePullRequests: (filters) => {
      const project = activeProject();
      if (project) setPrPanelFilters(project.id, filters);
    },
    resetPullRequestConfig: () => {
      const project = activeProject();
      if (project) setPrPanelFilters(project.id, defaultGitPrFilterConfig);
    },
    setPullRequestQuickFilter: (quick) => {
      const project = activeProject();
      if (project) setPrPanelQuickFilter(project.id, quick);
    },
    selectRepository: (repository) => {
      const project = activeProject();
      if (project) selectGitRepo(project.id, repository);
    },
    // Hover or focus on a branch row is the server's `hint` demand.
    hintRepository: (repository) => {
      const project = activeProject();
      if (project) hintGitRepo(project.id, repository);
    },
    createBranch: (repository, name) => {
      const project = activeProject();
      return project
        ? createGitRepoBranch(project.id, repository, name)
        : false;
    },
    switchBranch: (repository, branch) => {
      const project = activeProject();
      return project
        ? switchGitRepoBranch(project.id, repository, branch)
        : false;
    },
    deleteBranch: (repository, branch) => {
      const project = activeProject();
      return project
        ? deleteGitRepoBranch(project.id, repository, branch)
        : false;
    },
    openDiff: (repository, file, area) => {
      const project = activeProject();
      if (project)
        return openDiffPane({
          projectId: project.id,
          repo: repository,
          path: file.path,
          renamedFrom: file.renamedFrom,
          area,
        });
    },
    mutateFile: (repository, file, action) => {
      const project = activeProject();
      if (project) return mutateGitFile(project.id, repository, file, action);
    },
    mutateFileScope: (repository, area, action, path) => {
      const project = activeProject();
      if (project)
        return mutateGitFileScope(project.id, repository, area, action, path);
    },
    createStash: (repository, area, path) => {
      const project = activeProject();
      if (project)
        return createGitRepoStash(project.id, repository, area, path);
    },
    setChangeTreeFolderExpanded: (repository, key, expanded) => {
      const project = activeProject();
      if (project)
        setGitChangeTreeFolderExpanded(project.id, repository, key, expanded);
    },
    applyStash: (repository, stash) => {
      const project = activeProject();
      if (project) return applyGitRepoStash(project.id, repository, stash);
    },
    dropStash: (repository, stash) => {
      const project = activeProject();
      if (project) return dropGitRepoStash(project.id, repository, stash);
    },
    runRemoteOperation: (repository, operation) => {
      const project = activeProject();
      if (!project) return;
      const operations: Record<GitRemoteOperation, () => Promise<void>> = {
        fetch: () => fetchGitRepo(project.id, repository),
        pull: () => pullGitRepo(project.id, repository),
        push: () => pushGitRepo(project.id, repository),
        sync: () => syncGitRepo(project.id, repository),
        "switch-base-and-pull": () =>
          switchBaseAndPullGitRepo(project.id, repository),
      };
      return operations[operation]();
    },
    selectPullRequest: () => undefined,
    openPullRequest: (repository, number) => {
      const project = activeProject();
      if (project)
        return openPrPane({ projectId: project.id, repo: repository, number });
    },
  };
  adapter.actions = createGitPanelActions(() => adapter.model, host);

  $effect(() => {
    const project = activeProject();
    const active = workbenchStartupState.progressiveActive && enabled();
    const list = pullRequestsEnabled();
    const repos = project
      ? (gitWorkspaceSnapshot(project.id)?.summaries ?? noRepositories)
      : noRepositories;
    const selected = project ? selectedGitRepo(project.id) : undefined;
    // While the Pull requests tab is on screen every GitHub repository is
    // shown once (deduplicated by owner/name, via its primary checkout).
    const shown: string[] =
      project && list
        ? githubCheckoutGroups(project.id, repos).map(
            (group) => group.repository,
          )
        : [];
    // Branch rows of expanded repositories show their PR glyph.
    const expandedGroups = project
      ? gitProjectView(project.id).expanded
      : undefined;
    const cleanups = repos
      .filter((repo) => repo.hasGithubRemote)
      .map((repo) =>
        watchPullRequests(() =>
          project && active
            ? {
                projectId: project.id,
                repo: repo.relativePath,
                visible:
                  repo.relativePath === selected ||
                  shown.includes(repo.relativePath) ||
                  Boolean(expandedGroups?.has(worktreeGroupOf(repo))),
                list: list && shown.includes(repo.relativePath),
                branch: repo.currentBranch ?? undefined,
                prs: [],
              }
            : undefined,
        ),
      );
    return () => cleanups.forEach((cleanup) => cleanup());
  });

  // Server-owned Git state: declare what this panel shows. Summaries of every
  // repository while the panel is on screen, the selected worktree's files and
  // stashes while the Changes section is open, and the hovered or focused
  // branch row as a hint (open diffs declare their own detail demand).
  $effect(() => {
    const project = activeProject();
    const active = workbenchStartupState.progressiveActive && enabled();
    if (!project || !active) return;
    const projectId = project.id;
    return watchGitWorkspace(() => {
      const selected = selectedGitRepo(projectId);
      const detail = !gitPanelLayout().changes.collapsed
        ? [selected]
        : undefined;
      const hint = gitHintedRepo(projectId);
      return {
        projectId,
        visible: true,
        ...(detail ? { detail } : {}),
        ...(hint ? { hint } : {}),
      };
    });
  });

  // Reconcile remembered choices with the repositories that exist, and keep the
  // selected repository's GitHub status loaded.
  $effect(() => {
    const project = activeProject();
    if (!project || !(workbenchStartupState.progressiveActive && enabled()))
      return;
    const snapshot = gitWorkspaceSnapshot(project.id);
    if (!snapshot?.loaded) return;
    const selected = selectedGitRepo(project.id);
    untrack(() => {
      gitProjectView(project.id).reconcile(snapshot.summaries, selected);
      void refreshGithub(project.id, selected);
    });
  });

  let lastProjectId: string | undefined;
  $effect(() => {
    const project = activeProject();
    if (
      !shouldActivateGitPanel({
        progressiveActive: workbenchStartupState.progressiveActive,
        enabled: enabled(),
        projectId: project?.id,
        lastProjectId,
      })
    )
      return;
    lastProjectId = project?.id;
    if (project) void readGitWorkspace(project.id);
  });

  return adapter;
}

function prNotice(projectId: string, repo: string): string | undefined {
  const status = repoPrStatus(projectId, repo);
  if (status.status === "rate_limited")
    return "Pull request updates are paused by GitHub’s rate limit.";
  if (status.status === "unauthenticated")
    return "Sign in to GitHub to receive pull request updates.";
  if (status.status === "unavailable")
    return "Pull request updates are unavailable.";
  return (
    status.error ||
    (status.status === "error"
      ? "Pull request updates are temporarily unavailable."
      : undefined)
  );
}
