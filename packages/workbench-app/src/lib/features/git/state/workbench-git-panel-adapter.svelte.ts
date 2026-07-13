import {
  createGitPanelActions,
  disabledCapability,
  enabledCapability,
  type GitPanelActions,
  type GitPanelModel,
  type GitRemoteOperation,
} from "@nervekit/workbench-ui";
import type { ProjectRecord } from "$lib/api";
import { hasPendingPrChecks } from "$lib/features/git/checks";
import { openPrPane } from "$lib/features/git/state/pr-tabs.svelte";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/core/state/state-keys";
import {
  autoRefreshGitOverview,
  bulkStageGitFiles,
  createGitRepoBranch,
  fetchGitRepo,
  gitPanelState,
  mutateGitFile,
  pullGitRepo,
  pushGitRepo,
  refreshBranches,
  refreshGitOverview,
  refreshGitProject,
  refreshPrs,
  selectGitProject,
  selectGitRepo,
  switchBaseAndPullGitRepo,
  switchGitRepoBranch,
  syncGitRepo,
} from "./git-panel.svelte";

const GIT_OVERVIEW_AUTO_REFRESH_MS = 5_000;
const GITHUB_CHECKS_POLL_MS = 10_000;
const unsupported = disabledCapability(
  "Select a project to use Git operations.",
);

export function createWorkbenchGitPanelAdapter(
  activeProject: () => ProjectRecord | undefined,
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
            current?.loadingOverview &&
            (current.repoSummary || current.changes),
          ),
        loadingOverview: current?.loadingOverview ?? false,
        loadingBranches: current?.loadingBranches ?? false,
        loadingPullRequests: current?.loadingPrs ?? false,
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
    refreshRepository: (repository) => {
      const project = activeProject();
      if (project)
        return refreshGitOverview(project.id, repository, { force: true });
    },
    refreshBranches: (repository) => {
      const project = activeProject();
      if (project) return refreshBranches(project.id, repository);
    },
    refreshPullRequests: (repository) => {
      const project = activeProject();
      if (project) return refreshPrs(project.id, repository);
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
    if (project?.id === lastProjectId) return;
    lastProjectId = project?.id;
    if (project) queueMicrotask(() => selectGitProject(project));
  });

  $effect(() => {
    const project = activeProject();
    const model = adapter.model;
    if (
      !project ||
      model.repositories.length === 0 ||
      !model.selectedRepository
    )
      return;
    const interval = window.setInterval(
      () => autoRefreshGitOverview(project.id, model.selectedRepository),
      GIT_OVERVIEW_AUTO_REFRESH_MS,
    );
    return () => window.clearInterval(interval);
  });

  $effect(() => {
    const project = activeProject();
    const model = adapter.model;
    if (
      !project ||
      model.repositories.length === 0 ||
      !model.repositorySummary?.hasGithubRemote ||
      !model.github?.authenticated ||
      !hasPendingPrChecks([...model.pullRequests])
    )
      return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void refreshPrs(project.id, model.selectedRepository, true);
    };
    refresh();
    const interval = window.setInterval(refresh, GITHUB_CHECKS_POLL_MS);
    return () => window.clearInterval(interval);
  });

  return adapter;
}
