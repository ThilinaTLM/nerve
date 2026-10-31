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
import { lastRemoteFailure } from "../views/git-remote-actions";
import { createGitPanelActions } from "../views/git-panel-controller";
import {
  requestGitRepositoryRefresh,
  getGitOverview,
  startBulkGitOperation,
  cancelGitOperation,
} from "../api/git.api";
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
import {
  defaultGitPrFilterConfig,
  normalizeGitPrFilterConfig,
} from "../pr-filters";
import type { Project } from "@nervekit/contracts/core";
import type { GitOperationBulkStartRequest } from "@nervekit/contracts/git";
import { openDiffPane } from "$lib/features/git/state/diff-tabs.svelte";
import { openPrPane } from "$lib/features/git/state/pr-tabs.svelte";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/domain/navigation/view-keys";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { shouldActivateGitPanel } from "./git-startup-policy";
import {
  applyGitRepoStash,
  autoRefreshGitOverview,
  createGitRepoBranch,
  createGitRepoStash,
  deleteGitRepoBranch,
  fetchGitRepo,
  dropGitRepoStash,
  gitPanelState,
  mutateGitFile,
  mutateGitFileScope,
  savePrFilters,
  pullGitRepo,
  pushGitRepo,
  refreshBranches,
  refreshGithub,
  refreshGitOverview,
  refreshGitProject,
  selectGitProject,
  setGitChangeTreeFolderExpanded,
  setGitOverviewRefreshVisible,
  selectGitRepo,
  switchBaseAndPullGitRepo,
  switchGitRepoBranch,
  syncGitRepo,
} from "./git-panel.svelte";

const unsupported = disabledCapability(
  "Select a project to use Git operations.",
);
const emptyCollapsedFolders: ReadonlySet<string> = new Set();

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
      const repositories = projectState?.repos ?? [];
      const selectedRepository = projectState?.selectedRepo ?? ".";
      const current =
        projectState?.repoStates[gitRepoStateKey(selectedRepository)];
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
        repositorySummary: current?.repoSummary,
        changes: current?.changes,
        branches: current?.branches ?? [],
        collapsedChangeTreeFolders:
          current?.collapsedChangeTreeFolders ?? emptyCollapsedFolders,
        stashes: current?.stashes ?? [],
        github: current?.github,
        pullRequests: project
          ? repoPrs(
              project.id,
              selectedRepository,
              current?.prFilters ?? defaultGitPrFilterConfig,
              current?.repoSummary?.currentBranch,
            )
          : [],
        prHeads: project
          ? repoPrHeads(project.id, selectedRepository)
          : undefined,
        currentBranchPr: project
          ? branchPr(
              project.id,
              selectedRepository,
              current?.repoSummary?.currentBranch,
            )
          : undefined,
        awaitingPullRequest: project
          ? awaitingPr(
              project.id,
              selectedRepository,
              current?.repoSummary?.currentBranch,
            )
          : false,
        expectedPullRequestUrl: project
          ? expectedPrUrl(project.id, selectedRepository)
          : undefined,
        pullRequestFilters: current?.prFilters ?? defaultGitPrFilterConfig,
        initialLoading:
          Boolean(project && !projectState) ||
          Boolean(projectState?.loadingRepos) ||
          Boolean(
            projectState?.discoveryRequest.inFlight &&
            !projectState.loaded &&
            repositories.length === 0,
          ),
        cachedError: projectState?.discoverError,
        readErrors: projectState?.readErrors,
        stale: Boolean(
          projectState?.readsStale || current?.overviewInvalidated,
        ),
        refreshing:
          Boolean(projectState?.refreshingRepos) ||
          Boolean(
            (current?.loadingOverview ||
              (project &&
                repoPrStatus(project.id, selectedRepository).refreshing)) &&
            (current?.repoSummary || current?.changes),
          ),
        loadingOverview: current?.loadingOverview ?? false,
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
            repoSummary:
              state?.repoSummary ??
              repositories.find((repo) => repo.relativePath === repository),
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
      const repos = adapter.model.repositories
        .filter((repo) => repo.hasRemote)
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
    refreshAll: () => {
      const project = activeProject();
      if (project)
        return refreshGitProject(project, {
          force: true,
          criticalErrorTitle: "Could not refresh Git repositories",
        });
    },
    refreshRepository: async (repository) => {
      const project = activeProject();
      if (!project) return;
      await requestGitRepositoryRefresh(project.id, repository);
      await Promise.all([
        refreshGitOverview(project.id, repository, {
          force: true,
          criticalErrorTitle: "Could not refresh repository",
        }),
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
      try {
        const overview = await getGitOverview(project.id, repository);
        if (activeProject()?.id !== project.id) return;
        return overview.stashes;
      } catch {
        if (activeProject()?.id === project.id)
          notify.error("Could not load stashes");
      }
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
    configurePullRequests: (repository, filters) => {
      const project = activeProject();
      if (!project) return;
      const state =
        gitPanelState.projects[gitProjectStateKey(project.id)]?.repoStates[
          gitRepoStateKey(repository)
        ];
      if (!state) return;
      state.prFilters = normalizeGitPrFilterConfig(filters);
      savePrFilters(project.id, repository, state.prFilters);
    },
    resetPullRequestConfig: (repository) => {
      const project = activeProject();
      if (!project) return;
      const state =
        gitPanelState.projects[gitProjectStateKey(project.id)]?.repoStates[
          gitRepoStateKey(repository)
        ];
      if (!state) return;
      state.prFilters = defaultGitPrFilterConfig;
      savePrFilters(project.id, repository, state.prFilters);
    },
    selectRepository: (repository) => {
      const project = activeProject();
      if (project) selectGitRepo(project.id, repository);
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
    const projectState = project
      ? gitPanelState.projects[gitProjectStateKey(project.id)]
      : undefined;
    const cleanups = (projectState?.repos ?? [])
      .filter((repo) => repo.hasGithubRemote)
      .map((repo) =>
        watchPullRequests(() =>
          project && active
            ? {
                projectId: project.id,
                repo: repo.relativePath,
                visible: repo.relativePath === projectState?.selectedRepo,
                list: list && repo.relativePath === projectState?.selectedRepo,
                branch:
                  projectState?.repoStates[gitRepoStateKey(repo.relativePath)]
                    ?.repoSummary?.currentBranch ??
                  repo.currentBranch ??
                  undefined,
                prs: [],
              }
            : undefined,
        ),
      );
    return () => cleanups.forEach((cleanup) => cleanup());
  });

  let lastProjectId: string | undefined;
  $effect(() => {
    const project = activeProject();
    const panelEnabled = enabled();
    if (
      !shouldActivateGitPanel({
        progressiveActive: workbenchStartupState.progressiveActive,
        enabled: panelEnabled,
        projectId: project?.id,
        lastProjectId,
      })
    )
      return;
    lastProjectId = project?.id;
    if (project)
      queueMicrotask(() => {
        if (workbenchStartupState.progressiveActive && enabled())
          selectGitProject(project);
      });
  });

  $effect(() => {
    const active = workbenchStartupState.progressiveActive && enabled();
    const project = activeProject();
    const projectState = project
      ? gitPanelState.projects[gitProjectStateKey(project.id)]
      : undefined;
    const repository = projectState?.selectedRepo;
    if (!active || !project || !projectState?.repos.length || !repository)
      return;
    // Registration depends on scope/visibility, not on the freshness state read
    // by these commands. Otherwise each completed read sends another hard scan.
    return untrack(() => {
      setGitOverviewRefreshVisible(project.id, repository, true);
      const refreshIfStale = () => {
        void requestGitRepositoryRefresh(project.id, repository).catch(
          () => undefined,
        );
        autoRefreshGitOverview(project.id, repository);
        if (projectState.readsStale)
          void refreshGitProject(project, {
            uncertain: true,
            silent: true,
            loadDetails: false,
          });
      };
      const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") refreshIfStale();
      };
      refreshIfStale();
      window.addEventListener("focus", refreshIfStale);
      document.addEventListener("visibilitychange", refreshWhenVisible);
      return () => {
        setGitOverviewRefreshVisible(project.id, repository, false);
        window.removeEventListener("focus", refreshIfStale);
        document.removeEventListener("visibilitychange", refreshWhenVisible);
      };
    });
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
