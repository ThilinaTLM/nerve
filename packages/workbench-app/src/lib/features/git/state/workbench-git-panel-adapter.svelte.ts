import {
  createGitPanelActions,
  defaultGitPrFilterConfig,
  disabledCapability,
  normalizeGitPrFilterConfig,
  enabledCapability,
  type GitPanelActions,
  type GitPanelModel,
  type GitRemoteOperation,
} from "$lib/presentation";
import type { ProjectRecord } from "$lib/api";
import { openDiffPane } from "$lib/features/git/state/diff-tabs.svelte";
import { openPrPane } from "$lib/features/git/state/pr-tabs.svelte";
import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/core/state/state-keys";
import { pendingPollTargets, PR_PENDING_POLL_MS } from "./git-refresh-policy";
import { workbenchStartupState } from "$lib/core/startup/workbench-startup-state.svelte";
import { shouldActivateGitPanel } from "./git-startup-policy";
import {
  autoRefreshGitOverview,
  autoRefreshPrsIfStale,
  bulkStageGitFiles,
  createGitRepoBranch,
  fetchGitRepo,
  gitPanelState,
  mutateGitFile,
  savePrFilters,
  pullGitRepo,
  pushGitRepo,
  refreshBranches,
  refreshGithub,
  refreshGitOverview,
  refreshGitProject,
  refreshPrs,
  selectGitProject,
  setGitOverviewRefreshVisible,
  selectGitRepo,
  switchBaseAndPullGitRepo,
  switchGitRepoBranch,
  syncGitRepo,
} from "./git-panel.svelte";

const unsupported = disabledCapability(
  "Select a project to use Git operations.",
);

export function createWorkbenchGitPanelAdapter(
  activeProject: () => ProjectRecord | undefined,
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
        github: current?.github,
        pullRequests: current?.prs ?? [],
        pullRequestFilters: current?.prFilters ?? defaultGitPrFilterConfig,
        initialLoading:
          Boolean(project && !projectState) ||
          Boolean(projectState?.loadingRepos) ||
          Boolean(
            projectState?.reposRequestInFlight &&
            !projectState.loaded &&
            repositories.length === 0,
          ),
        cachedError: projectState?.discoverError,
        refreshing:
          Boolean(projectState?.refreshingRepos) ||
          Boolean(
            (current?.loadingOverview || current?.loadingPrs) &&
            (current.repoSummary || current.changes),
          ),
        loadingOverview: current?.loadingOverview ?? false,
        loadingBranches: current?.loadingBranches ?? false,
        loadingPullRequests: current?.loadingPrs ?? false,
        pullRequestError: current?.prsError,
        operations: current?.operations ?? {
          fetching: false,
          pulling: false,
          pushing: false,
          syncing: false,
          switchingBaseAndPulling: false,
          creatingBranch: false,
        },
        capabilities,
      };
    },
    actions: undefined as unknown as GitPanelActions,
  };

  const host: GitPanelActions = {
    refreshAll: () => {
      const project = activeProject();
      if (project) return refreshGitProject(project, { force: true });
    },
    refreshRepository: async (repository) => {
      const project = activeProject();
      if (project)
        await Promise.all([
          refreshGitOverview(project.id, repository, { force: true }),
          refreshGithub(project.id, repository, true),
        ]);
    },
    refreshBranches: (repository) => {
      const project = activeProject();
      if (project) return refreshBranches(project.id, repository);
    },
    refreshPullRequests: async (repository) => {
      const project = activeProject();
      if (project)
        await Promise.all([
          refreshGitOverview(project.id, repository, { force: true }),
          refreshGithub(project.id, repository, true),
        ]);
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
      return refreshPrs(project.id, repository, false, true);
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
      return refreshPrs(project.id, repository, false, true);
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
    bulkMutateFiles: (repository, action) => {
      const project = activeProject();
      if (project) return bulkStageGitFiles(project.id, repository, action);
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
    setGitOverviewRefreshVisible(project.id, repository, true);
    const refreshIfStale = () => {
      autoRefreshGitOverview(project.id, repository);
      if (pullRequestsEnabled()) autoRefreshPrsIfStale(project.id, repository);
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

  $effect(() => {
    const active =
      workbenchStartupState.progressiveActive &&
      enabled() &&
      pullRequestsEnabled();
    const project = activeProject();
    const projectState = project
      ? gitPanelState.projects[gitProjectStateKey(project.id)]
      : undefined;
    const repository = projectState?.selectedRepo;
    const repoState = repository
      ? projectState?.repoStates[gitRepoStateKey(repository)]
      : undefined;
    const pullRequests = repoState?.prs ?? [];
    const activePr = gitSelectors.activeCenterPrView;
    if (
      !active ||
      !project ||
      !projectState?.repos.length ||
      !repository ||
      !repoState?.repoSummary?.hasGithubRemote ||
      !repoState.github?.authenticated
    )
      return;
    const activePrMatches =
      activePr?.projectId === project.id && activePr.repo === repository;
    const targets = pendingPollTargets({
      visible: document.visibilityState === "visible",
      prs: pullRequests,
      activePrNumber: activePrMatches ? activePr?.number : undefined,
      activePrPending:
        activePrMatches && activePr?.checks.data?.checks.status === "pending",
    });
    if (!targets.pollList) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void refreshPrs(project.id, repository, true, true);
    };
    const interval = window.setInterval(refresh, PR_PENDING_POLL_MS);
    return () => window.clearInterval(interval);
  });

  return adapter;
}
