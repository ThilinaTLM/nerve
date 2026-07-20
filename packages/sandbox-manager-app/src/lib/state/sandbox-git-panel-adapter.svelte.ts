import type {
  GitBranchSummary,
  GitFileChange,
  GitOverviewResponse,
  GitRepoSummary,
  GithubPr,
  GithubStatusResponse,
  ManagedSandboxRecord,
} from "@nervekit/contracts";
import { notify } from "@nervekit/ui-kit/core/notify";
import {
  createGitPanelActions,
  defaultGitPrFilterConfig,
  disabledCapability,
  enabledCapability,
  gitFileGroups,
  normalizeGitPrFilterConfig,
  type GitPanelActions,
  type GitPrFilterConfig,
  type GitPanelModel,
  type GitRemoteOperation,
} from "@nervekit/workbench-ui";
import {
  createSandboxGitBranch,
  discoverSandboxGitRepos,
  getSandboxGithubStatus,
  getSandboxGitOverview,
  listSandboxGitBranches,
  listSandboxGithubPrs,
  sandboxGitFileAction,
  sandboxGitRemoteAction,
  switchSandboxGitBranch,
} from "../api/sandbox-git.api";
import { sandboxCanForwardCommand } from "./sandbox-lifecycle";
import type { SandboxDetailState } from "./sandbox-ui-types";

const disconnected = disabledCapability(
  "Start or reconnect the sandbox to use Git operations.",
);

function prFiltersStorageKey(sandboxId: string, repo: string): string {
  return `nerve.git.prFilters.sandbox.${sandboxId}.${encodeURIComponent(repo)}`;
}

function storedPrFilters(sandboxId: string, repo: string): GitPrFilterConfig {
  if (typeof localStorage === "undefined") return defaultGitPrFilterConfig;
  try {
    const raw = localStorage.getItem(prFiltersStorageKey(sandboxId, repo));
    if (!raw) return defaultGitPrFilterConfig;
    const value = JSON.parse(raw) as Partial<GitPrFilterConfig>;
    if (
      !["any", "me", "username"].includes(String(value.author)) ||
      typeof value.username !== "string" ||
      !["include", "exclude", "only"].includes(String(value.drafts)) ||
      typeof value.title !== "string" ||
      typeof value.currentBranchOnly !== "boolean" ||
      !Array.isArray(value.labels) ||
      !value.labels.every((label) => typeof label === "string") ||
      !["updated-desc", "updated-asc"].includes(String(value.sort))
    ) {
      return defaultGitPrFilterConfig;
    }
    return normalizeGitPrFilterConfig(value as GitPrFilterConfig);
  } catch {
    return defaultGitPrFilterConfig;
  }
}

function savePrFilters(
  sandboxId: string,
  repo: string,
  filters: GitPrFilterConfig,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      prFiltersStorageKey(sandboxId, repo),
      JSON.stringify(filters),
    );
  } catch {
    // Persistence is best effort.
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function createSandboxGitPanelAdapter(
  record: () => ManagedSandboxRecord,
  detail: () => SandboxDetailState | undefined,
  openPullRequest: (repository: string, number: number) => void,
): { readonly model: GitPanelModel; readonly actions: GitPanelActions } {
  let repositories = $state<GitRepoSummary[]>([]);
  let selectedRepository = $state(".");
  let overview = $state<GitOverviewResponse | undefined>(undefined);
  let branches = $state<GitBranchSummary[]>([]);
  let github = $state<GithubStatusResponse | undefined>(undefined);
  let pullRequests = $state<GithubPr[]>([]);
  let prFilters = $state<GitPrFilterConfig>(defaultGitPrFilterConfig);
  let error = $state<string | undefined>(undefined);
  let loadingRepositories = $state(false);
  let loadingOverview = $state(false);
  let loadingBranches = $state(false);
  let loadingPullRequests = $state(false);
  let prRequestSeq = 0;
  let refreshing = $state(false);
  let switchingBranch = $state<string | undefined>(undefined);
  let creatingBranch = $state(false);
  let fetching = $state(false);
  let pulling = $state(false);
  let pushing = $state(false);
  let syncing = $state(false);
  let switchingBaseAndPulling = $state(false);
  let fileMutation = $state<
    { path: string; action: "stage" | "unstage" | "discard" } | undefined
  >(undefined);
  let bulkMutation = $state<"stage-all" | "unstage-all" | undefined>(undefined);
  let loadedSandboxId = $state<string | undefined>(undefined);
  let initialRefreshSandboxId = $state<string | undefined>(undefined);

  const connected = () => sandboxCanForwardCommand(record(), detail());
  const capability = () => (connected() ? enabledCapability : disconnected);
  const adapter = {
    get model(): GitPanelModel {
      const selectedSummary =
        overview?.repo ??
        repositories.find(
          (candidate) => candidate.relativePath === selectedRepository,
        );
      const currentCapability = capability();
      return {
        availability: connected()
          ? { available: true }
          : {
              available: false,
              message:
                "Connect or start the sandbox to inspect Git state and run Git operations.",
            },
        emptyMessage: "No Git repositories found under /workspace.",
        repositories,
        selectedRepository,
        repositorySummary: selectedSummary,
        changes: overview,
        branches,
        github,
        pullRequests,
        pullRequestFilters: prFilters,
        initialLoading: loadingRepositories && repositories.length === 0,
        cachedError: error,
        refreshing,
        loadingOverview,
        loadingBranches,
        loadingPullRequests,
        operations: {
          fetching,
          pulling,
          pushing,
          syncing,
          switchingBaseAndPulling,
          switchingBranch,
          creatingBranch,
          fileMutation,
          bulkMutation,
        },
        capabilities: {
          refresh: currentCapability,
          selectRepository: currentCapability,
          branches: currentCapability,
          mutateFiles: currentCapability,
          bulkMutateFiles: currentCapability,
          remote: {
            fetch: currentCapability,
            pull: currentCapability,
            push: currentCapability,
            sync: currentCapability,
            "switch-base-and-pull": currentCapability,
          },
          openPullRequest: currentCapability,
        },
      };
    },
    actions: undefined as unknown as GitPanelActions,
  };

  async function refreshOverview(
    repository = selectedRepository,
  ): Promise<void> {
    loadingOverview = true;
    try {
      overview = await getSandboxGitOverview(record().sandboxId, repository);
      repositories = repositories.map((candidate) =>
        candidate.relativePath === overview?.repo.relativePath
          ? overview.repo
          : candidate,
      );
      error = undefined;
    } catch (caught) {
      error = errorMessage(caught);
    } finally {
      loadingOverview = false;
    }
  }

  async function refreshBranches(
    repository = selectedRepository,
  ): Promise<void> {
    loadingBranches = true;
    try {
      branches = (await listSandboxGitBranches(record().sandboxId, repository))
        .branches;
    } catch (caught) {
      notify.error("Could not list branches", {
        description: errorMessage(caught),
      });
    } finally {
      loadingBranches = false;
    }
  }

  async function refreshPullRequests(
    repository = selectedRepository,
  ): Promise<void> {
    const requestSeq = ++prRequestSeq;
    loadingPullRequests = true;
    const currentBranch =
      (overview?.repo.relativePath === repository
        ? overview.repo.currentBranch
        : undefined) ??
      repositories.find((candidate) => candidate.relativePath === repository)
        ?.currentBranch;
    try {
      const result = await listSandboxGithubPrs(
        record().sandboxId,
        repository,
        {
          author: prFilters.author,
          ...(prFilters.author === "username"
            ? { username: prFilters.username }
            : {}),
          drafts: prFilters.drafts,
          title: prFilters.title,
          ...(prFilters.currentBranchOnly && currentBranch
            ? { head: currentBranch }
            : {}),
          labels: [...prFilters.labels],
          sort: prFilters.sort,
        },
      );
      if (requestSeq === prRequestSeq) pullRequests = result.prs;
    } catch (caught) {
      if (requestSeq === prRequestSeq) {
        notify.error("Could not load pull requests", {
          description: errorMessage(caught),
        });
      }
    } finally {
      if (requestSeq === prRequestSeq) loadingPullRequests = false;
    }
  }

  async function refreshGithub(repository = selectedRepository): Promise<void> {
    try {
      github = await getSandboxGithubStatus(record().sandboxId, repository);
      if (github.authenticated) await refreshPullRequests(repository);
      else pullRequests = [];
    } catch {
      github = undefined;
      pullRequests = [];
    }
  }

  async function refreshRepository(repository: string): Promise<void> {
    selectedRepository = repository;
    prFilters = storedPrFilters(record().sandboxId, repository);
    await Promise.all([
      refreshOverview(repository),
      refreshBranches(repository),
      refreshGithub(repository),
    ]);
  }

  async function refreshAll(): Promise<void> {
    if (!connected()) return;
    refreshing = true;
    loadingRepositories = true;
    try {
      const discovery = await discoverSandboxGitRepos(record().sandboxId);
      repositories = discovery.repos;
      selectedRepository = repositories.some(
        (repository) => repository.relativePath === selectedRepository,
      )
        ? selectedRepository
        : (repositories[0]?.relativePath ?? ".");
      if (repositories.length > 0) await refreshRepository(selectedRepository);
      error = undefined;
    } catch (caught) {
      error = errorMessage(caught);
    } finally {
      loadingRepositories = false;
      refreshing = false;
    }
  }

  function setRemoteFlag(operation: GitRemoteOperation, value: boolean): void {
    if (operation === "fetch") fetching = value;
    if (operation === "pull") pulling = value;
    if (operation === "push") pushing = value;
    if (operation === "sync") syncing = value;
    if (operation === "switch-base-and-pull") switchingBaseAndPulling = value;
  }

  const host: GitPanelActions = {
    refreshAll,
    refreshRepository,
    refreshBranches,
    refreshPullRequests,
    configurePullRequests: async (repository, filters) => {
      prFilters = normalizeGitPrFilterConfig(filters);
      savePrFilters(record().sandboxId, repository, prFilters);
      await refreshPullRequests(repository);
    },
    resetPullRequestConfig: async (repository) => {
      prFilters = defaultGitPrFilterConfig;
      savePrFilters(record().sandboxId, repository, prFilters);
      await refreshPullRequests(repository);
    },
    selectRepository: refreshRepository,
    createBranch: async (repository, name) => {
      creatingBranch = true;
      try {
        await createSandboxGitBranch(record().sandboxId, {
          repo: repository,
          name,
        });
        await refreshRepository(repository);
        return true;
      } catch (caught) {
        notify.error("Could not create branch", {
          description: errorMessage(caught),
        });
        return false;
      } finally {
        creatingBranch = false;
      }
    },
    switchBranch: async (repository, branch) => {
      if (branch.current) return false;
      switchingBranch = branch.name;
      try {
        await switchSandboxGitBranch(record().sandboxId, {
          repo: repository,
          name: branch.name,
        });
        await refreshRepository(repository);
        return true;
      } catch (caught) {
        notify.error("Could not switch branch", {
          description: errorMessage(caught),
        });
        return false;
      } finally {
        switchingBranch = undefined;
      }
    },
    mutateFile: async (repository, file: GitFileChange, action) => {
      fileMutation = { path: file.path, action };
      try {
        await sandboxGitFileAction(record().sandboxId, action, {
          repo: repository,
          path: file.path,
        });
        await refreshOverview(repository);
      } catch (caught) {
        notify.error("Could not update file", {
          description: errorMessage(caught),
        });
      } finally {
        fileMutation = undefined;
      }
    },
    bulkMutateFiles: async (repository, action) => {
      const groups = gitFileGroups(overview?.files ?? []);
      const files = action === "stage-all" ? groups.unstaged : groups.staged;
      bulkMutation = action;
      try {
        for (const file of files) {
          await sandboxGitFileAction(
            record().sandboxId,
            action === "stage-all" ? "stage" : "unstage",
            { repo: repository, path: file.path },
          );
        }
        await refreshOverview(repository);
      } catch (caught) {
        notify.error("Could not update files", {
          description: errorMessage(caught),
        });
      } finally {
        bulkMutation = undefined;
      }
    },
    runRemoteOperation: async (repository, operation) => {
      setRemoteFlag(operation, true);
      try {
        const apiOperation =
          operation === "switch-base-and-pull"
            ? "switchBaseAndPull"
            : operation;
        await sandboxGitRemoteAction(record().sandboxId, apiOperation, {
          repo: repository,
        });
        await refreshRepository(repository);
      } catch (caught) {
        notify.error("Git operation failed", {
          description: errorMessage(caught),
        });
      } finally {
        setRemoteFlag(operation, false);
      }
    },
    selectPullRequest: () => undefined,
    openPullRequest: (repository, number) =>
      openPullRequest(repository, number),
  };
  adapter.actions = createGitPanelActions(() => adapter.model, host);

  $effect(() => {
    const sandboxId = record().sandboxId;
    if (sandboxId === loadedSandboxId) return;
    loadedSandboxId = sandboxId;
    initialRefreshSandboxId = undefined;
    repositories = [];
    overview = undefined;
    branches = [];
    github = undefined;
    pullRequests = [];
    prFilters = defaultGitPrFilterConfig;
    prRequestSeq += 1;
    error = undefined;
  });

  $effect(() => {
    const sandboxId = record().sandboxId;
    if (!connected()) {
      initialRefreshSandboxId = undefined;
      return;
    }
    if (
      repositories.length === 0 &&
      !loadingRepositories &&
      initialRefreshSandboxId !== sandboxId
    ) {
      initialRefreshSandboxId = sandboxId;
      void refreshAll();
    }
  });

  $effect(() => {
    if (!connected() || repositories.length === 0) return;
    const repository = selectedRepository;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible")
        void refreshOverview(repository);
    }, 5_000);
    return () => window.clearInterval(interval);
  });

  return adapter;
}
