<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CloudDownload from "@lucide/svelte/icons/cloud-download";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { notify } from "$lib/notifications/notify.svelte";
  import {
    createGitBranch,
    discardGitFile,
    discoverGitRepos,
    fetchGit,
    getGitOverview,
    getGithubStatus,
    listGitBranches,
    listGithubPrs,
    stageGitFile,
    switchGitBranch,
    syncGitBranch,
    unstageGitFile,
    type AgentRecord,
    type GitBranchSummary,
    type GitFileChange,
    type GithubChecksSummary,
    type GithubPr,
    type GithubStatusResponse,
    type GitOverviewResponse,
    type GitRepoSummary,
    type ProjectRecord,
  } from "../../../api";
  import { Badge, type BadgeTone } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import * as Popover from "$lib/components/ui/popover";
  import { ToggleGroup, ToggleGroupItem } from "$lib/components/ui/toggle-group";
  import { cn } from "$lib/utils.js";
  import { invalidateGit } from "../../../stores/workbench/git-context.svelte";
  import { openPrPane } from "../../../stores/workbench/pr-tabs.svelte";
  import { workbenchState } from "../../../stores/workbench/state.svelte";
  import GitSection from "./GitSection.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeAgent?: AgentRecord;
  };

  type LoadOverviewOptions = {
    silent?: boolean;
    onlyIfChanged?: boolean;
  };

  const GIT_OVERVIEW_AUTO_REFRESH_MS = 4_000;
  const GITHUB_CHECKS_POLL_MS = 10_000;
  const MAX_CHANGE_PATH_LENGTH = 48;

  let { activeProject }: Props = $props();

  type FileMutation = { path: string; action: "stage" | "unstage" | "discard" };

  type RepoState = {
    overview?: GitOverviewResponse;
    github?: GithubStatusResponse;
    prs: GithubPr[];
    branches: GitBranchSummary[];
    loadingOverview: boolean;
    loadingPrs: boolean;
    loadingBranches: boolean;
    fetching: boolean;
    syncing: boolean;
    switchingBranch?: string;
    creatingBranch: boolean;
    fileMutation?: FileMutation;
    bulkMutation?: "stage-all" | "unstage-all";
    lastOverviewFingerprint?: string;
    overviewRequestInFlight: boolean;
    loaded: boolean;
  };

  function createRepoState(): RepoState {
    return {
      overview: undefined,
      github: undefined,
      prs: [],
      branches: [],
      loadingOverview: false,
      loadingPrs: false,
      loadingBranches: false,
      fetching: false,
      syncing: false,
      switchingBranch: undefined,
      creatingBranch: false,
      fileMutation: undefined,
      bulkMutation: undefined,
      lastOverviewFingerprint: undefined,
      overviewRequestInFlight: false,
      loaded: false,
    };
  }

  let repos = $state<GitRepoSummary[]>([]);
  let selectedRepo = $state(".");
  // Per-repo state cache so switching repositories never discards already-loaded
  // or in-flight state. Background operations write to their own repo entry and
  // keep running even while another repo is on screen.
  let repoStates = $state<Record<string, RepoState>>({});
  let discoverError = $state<string | undefined>(undefined);

  let repoSectionOpen = $state(true);
  let changesSectionOpen = $state(true);
  let prsSectionOpen = $state(true);
  let branchPopoverOpen = $state(false);
  let branchFilter = $state("");
  let newBranchName = $state("");
  let expandedPr = $state<number | undefined>(undefined);
  let discardCandidate = $state<{ repo: string; file: GitFileChange } | undefined>(undefined);
  let discardDialogOpen = $state(false);

  function repoState(repo: string): RepoState {
    if (!repoStates[repo]) {
      repoStates[repo] = createRepoState();
    }
    return repoStates[repo];
  }

  function repoMutationInProgress(state: RepoState): boolean {
    return (
      state.fetching ||
      state.syncing ||
      state.creatingBranch ||
      Boolean(state.switchingBranch) ||
      Boolean(state.fileMutation) ||
      Boolean(state.bulkMutation)
    );
  }

  const current = $derived(repoStates[selectedRepo]);
  const overview = $derived(current?.overview);
  const github = $derived(current?.github);
  const prs = $derived(current?.prs ?? []);
  const branches = $derived(current?.branches ?? []);
  const loadingOverview = $derived(current?.loadingOverview ?? false);
  const loadingPrs = $derived(current?.loadingPrs ?? false);
  const loadingBranches = $derived(current?.loadingBranches ?? false);
  const fetching = $derived(current?.fetching ?? false);
  const syncing = $derived(current?.syncing ?? false);
  const switchingBranch = $derived(current?.switchingBranch);
  const creatingBranch = $derived(current?.creatingBranch ?? false);
  const fileMutation = $derived(current?.fileMutation);
  const bulkMutation = $derived(current?.bulkMutation);

  const stagedFiles = $derived(overview?.files.filter((file) => file.staged) ?? []);
  const unstagedFiles = $derived(
    overview?.files.filter((file) => file.untracked || file.worktree !== " ") ?? [],
  );
  const currentBranchName = $derived(overview?.repo.currentBranch ?? null);
  const hasPendingChecks = $derived(prs.some((pr) => pr.checks.status === "pending"));
  const filteredBranches = $derived(
    branches.filter((branch) =>
      branch.name.toLowerCase().includes(branchFilter.trim().toLowerCase()),
    ),
  );
  const sortedPrs = $derived(
    [...prs].sort((a, b) => {
      const branch = currentBranchName;
      const aCurrent = branch !== null && a.headRefName === branch;
      const bCurrent = branch !== null && b.headRefName === branch;
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }),
  );

  function repoStorageKey(projectId: string): string {
    return `nerve.git.repo.${projectId}`;
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed?.error?.message) return String(parsed.error.message);
      } catch {
        // not JSON
      }
      return error.message;
    }
    return String(error);
  }

  function mergeRepoSummary(next: GitRepoSummary) {
    repos = repos.map((repo) =>
      repo.relativePath === next.relativePath ? next : repo,
    );
    const state = repoStates[next.relativePath];
    if (state?.overview && state.overview.repo.relativePath === next.relativePath) {
      state.overview = { ...state.overview, repo: next };
    }
  }

  function repoPathLabel(repo: GitRepoSummary): string {
    return repo.relativePath === "." ? "project root" : repo.relativePath;
  }

  function fileTone(file: GitFileChange): string {
    if (file.untracked) return "text-muted-foreground";
    if (file.index === "A") return "text-success";
    if (file.index === "D" || file.worktree === "D") return "text-destructive";
    return "text-info";
  }

  function statusLetter(file: GitFileChange, group: "staged" | "unstaged"): string {
    if (file.untracked) return "?";
    const code = group === "staged" ? file.index : file.worktree;
    return code === " " ? (file.index !== " " ? file.index : "M") : code;
  }

  function fileStatusLabel(file: GitFileChange, group: "staged" | "unstaged"): string {
    const code = group === "staged" ? file.index : file.worktree;
    if (file.untracked) return "untracked";
    switch (code) {
      case "A":
        return "added";
      case "D":
        return "deleted";
      case "R":
        return "renamed";
      case "M":
        return "modified";
      case "U":
        return "conflict";
      default:
        return group;
    }
  }

  function shortenPath(path: string): string {
    if (path.length <= MAX_CHANGE_PATH_LENGTH) return path;

    const segments = path.split("/");
    if (segments.length <= 2) {
      const available = Math.max(8, MAX_CHANGE_PATH_LENGTH - 3);
      const headLength = Math.ceil(available / 2);
      const tailLength = Math.floor(available / 2);
      return `${path.slice(0, headLength)}...${path.slice(-tailLength)}`;
    }

    const prefix = segments[0];
    const suffixParts = [segments.at(-1) ?? ""];
    for (let index = segments.length - 2; index > 0; index -= 1) {
      const candidateParts = [segments[index], ...suffixParts];
      const candidate = `${prefix}/.../${candidateParts.join("/")}`;
      if (candidate.length > MAX_CHANGE_PATH_LENGTH && suffixParts.length > 1) break;
      suffixParts.unshift(segments[index]);
      if (candidate.length >= MAX_CHANGE_PATH_LENGTH) break;
    }

    return `${prefix}/.../${suffixParts.join("/")}`;
  }

  function splitPath(path: string): { dir: string; base: string } {
    const index = path.lastIndexOf("/");
    if (index === -1) return { dir: "", base: path };
    return { dir: path.slice(0, index + 1), base: path.slice(index + 1) };
  }

  function checksTone(checks: GithubChecksSummary): BadgeTone {
    switch (checks.status) {
      case "passing":
        return "good";
      case "failing":
        return "danger";
      case "pending":
        return "warn";
      default:
        return "neutral";
    }
  }

  function overviewFingerprint(next: GitOverviewResponse): string {
    return JSON.stringify({
      repo: {
        currentBranch: next.repo.currentBranch,
        detached: next.repo.detached,
        ahead: next.repo.ahead,
        behind: next.repo.behind,
        hasUpstream: next.repo.hasUpstream,
        hasRemote: next.repo.hasRemote,
        baseBranch: next.repo.baseBranch,
        onBaseBranch: next.repo.onBaseBranch,
        mergedToBase: next.repo.mergedToBase,
      },
      counts: {
        staged: next.stagedCount,
        unstaged: next.unstagedCount,
        untracked: next.untrackedCount,
        insertions: next.insertions,
        deletions: next.deletions,
      },
      files: next.files.map((file) => ({
        path: file.path,
        renamedFrom: file.renamedFrom,
        index: file.index,
        worktree: file.worktree,
        staged: file.staged,
        untracked: file.untracked,
      })),
      latestCommit: next.recentCommits[0]?.hash ?? null,
    });
  }

  async function loadRepos(project: ProjectRecord) {
    discoverError = undefined;
    try {
      const result = await discoverGitRepos(project.id);
      if (activeProject?.id !== project.id) return;
      repos = result.repos;
      repoStates = {};
      const stored =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(repoStorageKey(project.id))
          : null;
      const fallback = result.repos[0]?.relativePath ?? ".";
      selectedRepo =
        stored && result.repos.some((repo) => repo.relativePath === stored)
          ? stored
          : fallback;
      if (result.repos.length > 0) {
        for (const repo of result.repos) repoState(repo.relativePath);
        await Promise.all([loadOverview(selectedRepo), loadGithub(selectedRepo)]);
      }
    } catch (error) {
      discoverError = errorMessage(error);
      repos = [];
      repoStates = {};
    }
  }

  async function loadOverview(repo: string, options: LoadOverviewOptions = {}) {
    if (!activeProject) return;
    const state = repoState(repo);
    if (state.overviewRequestInFlight) return;
    const { silent = false, onlyIfChanged = false } = options;
    const projectId = activeProject.id;
    state.overviewRequestInFlight = true;
    if (!silent) state.loadingOverview = true;
    try {
      const next = await getGitOverview(projectId, repo);
      if (activeProject?.id !== projectId) return;
      mergeRepoSummary(next.repo);
      const fingerprint = overviewFingerprint(next);
      if (!onlyIfChanged || fingerprint !== state.lastOverviewFingerprint) {
        state.overview = next;
      }
      state.lastOverviewFingerprint = fingerprint;
      state.loaded = true;
    } catch (error) {
      if (!silent) notify.error(`Git overview failed: ${errorMessage(error)}`);
    } finally {
      if (!silent) state.loadingOverview = false;
      state.overviewRequestInFlight = false;
    }
  }

  async function loadBranches(repo: string) {
    if (!activeProject) return;
    const state = repoState(repo);
    const projectId = activeProject.id;
    state.loadingBranches = true;
    try {
      const result = await listGitBranches(projectId, repo);
      if (activeProject?.id !== projectId) return;
      state.branches = result.branches;
    } catch (error) {
      notify.error(`Could not list branches: ${errorMessage(error)}`);
    } finally {
      state.loadingBranches = false;
    }
  }

  async function loadGithub(repo: string) {
    if (!activeProject) return;
    const state = repoState(repo);
    try {
      const status = await getGithubStatus(activeProject.id, repo);
      state.github = status;
      if (status.authenticated) {
        await loadPrs(repo);
      } else {
        state.prs = [];
      }
    } catch (error) {
      state.github = {
        available: false,
        authenticated: false,
        login: null,
        reason: errorMessage(error),
      };
      state.prs = [];
    }
  }

  async function loadPrs(repo: string, silent = false) {
    if (!activeProject) return;
    const state = repoState(repo);
    if (!silent) state.loadingPrs = true;
    try {
      state.prs = (await listGithubPrs(activeProject.id, repo)).prs;
    } catch (error) {
      if (!silent) notify.error(`Could not list PRs: ${errorMessage(error)}`);
    } finally {
      if (!silent) state.loadingPrs = false;
    }
  }

  function selectRepo(value: string) {
    if (value === selectedRepo) return;
    selectedRepo = value;
    if (activeProject && typeof localStorage !== "undefined") {
      localStorage.setItem(repoStorageKey(activeProject.id), value);
    }
    branchFilter = "";
    newBranchName = "";
    expandedPr = undefined;
    const state = repoState(value);
    if (!state.loaded) {
      // First visit: load fresh state for this repo.
      void loadOverview(value);
      void loadGithub(value);
    } else if (!repoMutationInProgress(state)) {
      // Cached state is shown instantly; quietly refresh in the background
      // without discarding what we already have.
      void loadOverview(value, { silent: true, onlyIfChanged: true });
      if (state.github?.authenticated) void loadPrs(value, true);
    }
  }

  async function onFetch(repo: string) {
    if (!activeProject) return;
    const state = repoState(repo);
    state.fetching = true;
    try {
      const result = await fetchGit(activeProject.id, repo);
      mergeRepoSummary(result.repo);
      notify.success("Fetched from remote");
      invalidateGit(activeProject.id);
      await loadOverview(repo);
      if (state.github?.authenticated) await loadPrs(repo, true);
    } catch (error) {
      notify.error(`Fetch failed: ${errorMessage(error)}`);
    } finally {
      state.fetching = false;
    }
  }

  async function onSync(repo: string) {
    if (!activeProject) return;
    const state = repoState(repo);
    state.syncing = true;
    try {
      const result = await syncGitBranch(activeProject.id, repo);
      mergeRepoSummary(result.repo);
      notify.success("Branch synced");
      invalidateGit(activeProject.id);
      await loadOverview(repo);
      if (state.github?.authenticated) await loadPrs(repo, true);
    } catch (error) {
      notify.error(`Sync failed: ${errorMessage(error)}`);
    } finally {
      state.syncing = false;
    }
  }

  async function onSwitchBranch(repo: string, branch: GitBranchSummary) {
    if (!activeProject || branch.current) return;
    const state = repoState(repo);
    state.switchingBranch = branch.name;
    try {
      const result = await switchGitBranch(activeProject.id, repo, branch.name);
      mergeRepoSummary(result.repo);
      branchPopoverOpen = false;
      branchFilter = "";
      newBranchName = "";
      state.branches = [];
      notify.success(`Switched to ${result.repo.currentBranch ?? branch.name}`);
      invalidateGit(activeProject.id);
      await Promise.all([loadOverview(repo), loadGithub(repo)]);
    } catch (error) {
      notify.error(`Switch branch failed: ${errorMessage(error)}`);
    } finally {
      state.switchingBranch = undefined;
    }
  }

  async function onCreateBranch(repo: string) {
    if (!activeProject || newBranchName.trim().length === 0) return;
    const name = newBranchName.trim();
    const state = repoState(repo);
    state.creatingBranch = true;
    try {
      const result = await createGitBranch(activeProject.id, repo, name);
      mergeRepoSummary(result.repo);
      branchPopoverOpen = false;
      branchFilter = "";
      newBranchName = "";
      state.branches = [];
      notify.success(`Created branch ${name}`);
      invalidateGit(activeProject.id);
      await Promise.all([loadOverview(repo), loadGithub(repo)]);
    } catch (error) {
      notify.error(`Create branch failed: ${errorMessage(error)}`);
    } finally {
      state.creatingBranch = false;
    }
  }

  async function mutateFile(
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ) {
    if (!activeProject) return;
    const state = repoState(repo);
    state.fileMutation = { path: file.path, action };
    try {
      const fn =
        action === "stage"
          ? stageGitFile
          : action === "unstage"
            ? unstageGitFile
            : discardGitFile;
      const result = await fn(activeProject.id, repo, file.path);
      mergeRepoSummary(result.repo);
      invalidateGit(activeProject.id);
      await loadOverview(repo);
    } catch (error) {
      notify.error(`${action[0].toUpperCase()}${action.slice(1)} failed: ${errorMessage(error)}`);
    } finally {
      state.fileMutation = undefined;
    }
  }

  async function bulkStage(repo: string, action: "stage-all" | "unstage-all") {
    if (!activeProject) return;
    const state = repoState(repo);
    const files = state.overview?.files ?? [];
    const targets =
      action === "stage-all"
        ? files.filter((file) => file.untracked || file.worktree !== " ")
        : files.filter((file) => file.staged);
    if (targets.length === 0) return;
    const fn = action === "stage-all" ? stageGitFile : unstageGitFile;
    state.bulkMutation = action;
    try {
      for (const file of targets) {
        await fn(activeProject.id, repo, file.path);
      }
      invalidateGit(activeProject.id);
      await loadOverview(repo);
    } catch (error) {
      notify.error(
        `${action === "stage-all" ? "Stage all" : "Unstage all"} failed: ${errorMessage(error)}`,
      );
    } finally {
      state.bulkMutation = undefined;
    }
  }

  function requestDiscard(file: GitFileChange) {
    discardCandidate = { repo: selectedRepo, file };
    discardDialogOpen = true;
  }

  function confirmDiscard() {
    const candidate = discardCandidate;
    discardCandidate = undefined;
    if (candidate) void mutateFile(candidate.repo, candidate.file, "discard");
  }

  function autoRefreshOverview() {
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const state = repoStates[selectedRepo];
    if (!state || state.overviewRequestInFlight || repoMutationInProgress(state)) return;
    void loadOverview(selectedRepo, { silent: true, onlyIfChanged: true });
  }

  $effect(() => {
    const projectId = activeProject?.id;
    const repo = selectedRepo;
    const repoCount = repos.length;
    if (!projectId || repoCount === 0 || !repo) return;
    const intervalId = window.setInterval(
      autoRefreshOverview,
      GIT_OVERVIEW_AUTO_REFRESH_MS,
    );
    return () => window.clearInterval(intervalId);
  });

  $effect(() => {
    if (!branchPopoverOpen || !activeProject || repos.length === 0) return;
    void loadBranches(selectedRepo);
  });

  $effect(() => {
    if (!activeProject || repos.length === 0 || !github?.authenticated || !hasPendingChecks) return;
    const repo = selectedRepo;
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadPrs(repo, true);
    }, GITHUB_CHECKS_POLL_MS);
    return () => window.clearInterval(intervalId);
  });

  let lastProjectId = $state<string | undefined>(undefined);
  $effect(() => {
    if (activeProject && activeProject.id !== lastProjectId) {
      lastProjectId = activeProject.id;
      void loadRepos(activeProject);
    } else if (!activeProject) {
      lastProjectId = undefined;
      repos = [];
      repoStates = {};
    }
  });

  let lastGitRefreshToken = workbenchState.gitRefreshToken;
  $effect(() => {
    const token = workbenchState.gitRefreshToken;
    if (token === lastGitRefreshToken) return;
    lastGitRefreshToken = token;
    if (activeProject && repos.length > 0) {
      void loadOverview(selectedRepo);
      void loadGithub(selectedRepo);
    }
  });
</script>

{#snippet changeRow(file: GitFileChange, group: "staged" | "unstaged")}
  {@const parts = splitPath(shortenPath(file.path))}
  {@const busy = fileMutation?.path === file.path}
  <div class="group flex items-center gap-2 rounded-sm px-1.5 py-0.5 hover:bg-muted/50">
    <span
      class={cn("w-3 shrink-0 text-center font-mono text-xs font-semibold", fileTone(file))}
      title={fileStatusLabel(file, group)}
    >
      {statusLetter(file, group)}
    </span>
    <div class="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
      {#if parts.dir}<span class="text-muted-foreground">{parts.dir}</span>{/if}<span class="text-foreground">{parts.base}</span>
    </div>
    <div
      class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      {#if group === "staged"}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel={`Unstage ${file.path}`}
          title="Unstage"
          disabled={busy}
          onclick={() => void mutateFile(selectedRepo, file, "unstage")}
        >
          {#if busy && fileMutation?.action === "unstage"}
            <LoaderCircle class="animate-spin" />
          {:else}
            <ArrowDownToLine />
          {/if}
        </Button>
      {:else}
        <Button
          size="icon-xs"
          variant="ghost"
          ariaLabel={`Stage ${file.path}`}
          title="Stage"
          disabled={busy}
          onclick={() => void mutateFile(selectedRepo, file, "stage")}
        >
          {#if busy && fileMutation?.action === "stage"}
            <LoaderCircle class="animate-spin" />
          {:else}
            <ArrowUpFromLine />
          {/if}
        </Button>
      {/if}
      <Button
        size="icon-xs"
        variant="ghost"
        ariaLabel={`Discard ${file.path}`}
        title="Discard"
        disabled={busy}
        onclick={() => requestDiscard(file)}
      >
        {#if busy && fileMutation?.action === "discard"}
          <LoaderCircle class="animate-spin" />
        {:else}
          <X />
        {/if}
      </Button>
    </div>
  </div>
{/snippet}

<div class="p-2">
  {#if !activeProject}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      Select a project to inspect its git repositories.
    </p>
  {:else if discoverError}
    <Card class="gap-0 overflow-hidden p-0">
      <div class="px-3 py-3 text-xs text-destructive">{discoverError}</div>
    </Card>
  {:else if repos.length === 0}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      No git repositories found in this directory (searched up to 2 levels deep).
    </p>
  {:else}
    <Card class="gap-0 overflow-hidden p-0">
      <GitSection title="Repo & Branch" icon={GitBranch} bind:open={repoSectionOpen}>
        {#if overview}
          {@const repo = overview.repo}
          <div class="flex flex-col gap-2">
            {#if repos.length > 1}
              <ToggleGroup
                type="single"
                value={selectedRepo}
                variant="outline"
                size="sm"
                class="flex-wrap"
                onValueChange={(value) => {
                  if (value) selectRepo(value);
                }}
              >
                {#each repos as repo (repo.relativePath)}
                  <ToggleGroupItem
                    value={repo.relativePath}
                    aria-label={`Switch to ${repo.name}`}
                    title={repoPathLabel(repo)}
                    class="font-mono text-xs"
                  >
                    {repo.name}
                  </ToggleGroupItem>
                {/each}
              </ToggleGroup>
            {/if}

            <div class="flex items-center gap-2">
              <Popover.Root bind:open={branchPopoverOpen}>
                <Popover.Trigger
                  class={cn(
                    "inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    repo.detached && "text-muted-foreground",
                  )}
                >
                  <GitBranch size={12} strokeWidth={2.2} class="shrink-0" />
                  <span class="truncate font-mono">{repo.currentBranch ?? "(detached)"}</span>
                  <ChevronDown size={12} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
                </Popover.Trigger>
                <Popover.Content align="start" collisionPadding={8} class="w-[min(360px,calc(100vw-2rem))] gap-3 p-3">
                  <div class="flex flex-col gap-0.5">
                    <div class="text-xs font-medium text-foreground">Switch branch</div>
                    <div class="text-xs text-muted-foreground">
                      Current: <span class="font-mono text-foreground">{repo.currentBranch ?? "detached"}</span>
                    </div>
                  </div>
                  <div class="relative">
                    <Search size={13} strokeWidth={2.1} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input bind:value={branchFilter} placeholder="Filter branches" class="h-8 pl-7 text-xs" />
                  </div>
                  <div class="max-h-56 overflow-y-auto rounded-md border">
                    {#if loadingBranches}
                      <div class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <LoaderCircle size={13} class="animate-spin" /> Loading branches…
                      </div>
                    {:else if filteredBranches.length === 0}
                      <div class="px-3 py-2 text-xs text-muted-foreground">No branches found.</div>
                    {:else}
                      {#each filteredBranches as branch (branch.name)}
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-muted/60 disabled:opacity-60"
                          disabled={branch.current || switchingBranch === branch.name}
                          onclick={() => void onSwitchBranch(selectedRepo, branch)}
                        >
                          {#if switchingBranch === branch.name}
                            <LoaderCircle size={13} class="animate-spin text-muted-foreground" />
                          {:else if branch.current}
                            <Check size={13} class="text-success" />
                          {:else}
                            <GitBranch size={13} class="text-muted-foreground" />
                          {/if}
                          <span class="min-w-0 flex-1 truncate font-mono text-foreground">{branch.name}</span>
                          {#if branch.remote}
                            <Badge tone="neutral" size="xs">remote</Badge>
                          {/if}
                        </button>
                      {/each}
                    {/if}
                  </div>
                  <div class="flex flex-col gap-1.5 border-t pt-3">
                    <div class="text-xs font-medium text-foreground">Create from current</div>
                    <div class="flex gap-1.5">
                      <Input bind:value={newBranchName} placeholder="feature/branch-name" class="h-8 font-mono text-xs" />
                      <Button
                        size="sm"
                        disabled={creatingBranch || newBranchName.trim().length === 0}
                        onclick={() => void onCreateBranch(selectedRepo)}
                      >
                        {#if creatingBranch}
                          <LoaderCircle class="animate-spin" />
                        {:else}
                          <GitBranch />
                        {/if}
                        Create
                      </Button>
                    </div>
                  </div>
                </Popover.Content>
              </Popover.Root>

              {#if repo.hasRemote}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  ariaLabel="Fetch"
                  title="Fetch from remote"
                  disabled={fetching}
                  onclick={() => void onFetch(selectedRepo)}
                >
                  {#if fetching}
                    <LoaderCircle class="animate-spin" />
                  {:else}
                    <CloudDownload />
                  {/if}
                </Button>
              {/if}

              <div class="flex min-w-0 items-center gap-1 text-xs">
                {#if !repo.hasRemote}
                  <span class="text-muted-foreground">local only</span>
                {:else if !repo.hasUpstream}
                  <span class="text-muted-foreground">no upstream</span>
                {:else if (repo.ahead ?? 0) === 0 && (repo.behind ?? 0) === 0}
                  <span class="flex items-center gap-0.5 text-muted-foreground">
                    <Check size={12} strokeWidth={2.2} /> up to date
                  </span>
                {:else}
                  {#if (repo.ahead ?? 0) > 0}
                    <Button
                      size="xs"
                      variant="ghost"
                      class="gap-0.5 px-1.5 font-mono text-info"
                      title="Sync current branch with upstream"
                      ariaLabel={`Sync branch (${repo.ahead} commits to push)`}
                      disabled={syncing || repo.detached}
                      onclick={() => void onSync(selectedRepo)}
                    >
                      {#if syncing}
                        <LoaderCircle class="animate-spin" />
                      {:else}
                        <ArrowUp strokeWidth={2.4} />
                      {/if}
                      {repo.ahead}
                    </Button>
                  {/if}
                  {#if (repo.behind ?? 0) > 0}
                    <Button
                      size="xs"
                      variant="ghost"
                      class="gap-0.5 px-1.5 font-mono text-warning"
                      title="Sync current branch with upstream"
                      ariaLabel={`Sync branch (${repo.behind} commits to pull)`}
                      disabled={syncing || repo.detached}
                      onclick={() => void onSync(selectedRepo)}
                    >
                      {#if syncing}
                        <LoaderCircle class="animate-spin" />
                      {:else}
                        <ArrowDown strokeWidth={2.4} />
                      {/if}
                      {repo.behind}
                    </Button>
                  {/if}
                {/if}
                {#if repo.detached}
                  <Badge tone="warn" size="xs">detached</Badge>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="py-1 text-xs text-muted-foreground">Loading…</div>
        {/if}
      </GitSection>

      <GitSection title="Changes" icon={FilePen} bind:open={changesSectionOpen}>
        {#snippet meta()}
          {#if overview}
            <span>{overview.stagedCount} staged</span>
            <span class="text-muted-foreground/50">·</span>
            <span>{overview.unstagedCount + overview.untrackedCount} unstaged</span>
          {/if}
        {/snippet}

        {#if loadingOverview && !overview}
          <div class="py-1 text-xs text-muted-foreground">Loading…</div>
        {:else if overview}
          {#if overview.files.length === 0}
            <p class="py-1 text-xs text-muted-foreground">Working tree clean.</p>
          {:else}
            <div class="flex flex-col gap-2">
              {#if stagedFiles.length > 0}
                <div class="flex flex-col">
                  <div class="flex items-center gap-1 px-1.5 text-xs font-medium text-muted-foreground">
                    <span>Staged</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      ariaLabel="Unstage all"
                      title="Unstage all"
                      disabled={Boolean(bulkMutation) || Boolean(fileMutation)}
                      onclick={() => void bulkStage(selectedRepo, "unstage-all")}
                    >
                      {#if bulkMutation === "unstage-all"}
                        <LoaderCircle class="animate-spin" />
                      {:else}
                        <ArrowDownToLine />
                      {/if}
                    </Button>
                    <span class="ml-auto">{stagedFiles.length}</span>
                  </div>
                  {#each stagedFiles as file (file.path)}
                    {@render changeRow(file, "staged")}
                  {/each}
                </div>
              {/if}
              {#if unstagedFiles.length > 0}
                <div class="flex flex-col">
                  <div class="flex items-center gap-1 px-1.5 text-xs font-medium text-muted-foreground">
                    <span>Unstaged</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      ariaLabel="Stage all"
                      title="Stage all"
                      disabled={Boolean(bulkMutation) || Boolean(fileMutation)}
                      onclick={() => void bulkStage(selectedRepo, "stage-all")}
                    >
                      {#if bulkMutation === "stage-all"}
                        <LoaderCircle class="animate-spin" />
                      {:else}
                        <ArrowUpFromLine />
                      {/if}
                    </Button>
                    <span class="ml-auto">{unstagedFiles.length}</span>
                  </div>
                  {#each unstagedFiles as file (file.path)}
                    {@render changeRow(file, "unstaged")}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <!-- future: commit / create-branch / create-PR action bar (agentic) -->
        {:else}
          <div class="py-1 text-xs text-muted-foreground">Loading…</div>
        {/if}
      </GitSection>

      <GitSection title="PRs (GitHub)" icon={GitPullRequest} bind:open={prsSectionOpen}>
        {#snippet actions()}
          {#if github?.authenticated}
            <Button
              size="icon-xs"
              variant="ghost"
              ariaLabel="Refresh PRs"
              title={`Refresh PRs · signed in as ${github.login ?? "unknown"}`}
              disabled={loadingPrs}
              onclick={() => void loadPrs(selectedRepo)}
            >
              <RefreshCw class={loadingPrs ? "animate-spin" : ""} />
            </Button>
          {/if}
        {/snippet}

        {#if !github}
          <div class="py-1 text-xs text-muted-foreground">Checking GitHub CLI…</div>
        {:else if !github.available}
          <div class="py-1 text-xs text-muted-foreground">
            GitHub CLI (<code class="font-mono">gh</code>) is not installed.
          </div>
        {:else if !github.authenticated}
          <div class="py-1 text-xs text-muted-foreground">
            Not authenticated. Run <code class="font-mono">gh auth login</code>.
          </div>
        {:else if loadingPrs && prs.length === 0}
          <div class="py-1 text-xs text-muted-foreground">Loading…</div>
        {:else if sortedPrs.length === 0}
          <div class="py-1 text-xs text-muted-foreground">No open PRs for this repository.</div>
        {:else}
          <div class="flex flex-col gap-1.5">
            {#each sortedPrs as pr (pr.number)}
              {@const currentPr = currentBranchName !== null && pr.headRefName === currentBranchName}
              <div class={cn("rounded-md border px-2 py-1.5", currentPr && "border-accent bg-muted/40")}>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-foreground hover:underline"
                    onclick={() =>
                      activeProject &&
                      void openPrPane({
                        projectId: activeProject.id,
                        repo: selectedRepo,
                        number: pr.number,
                      })}
                  >
                    <span class="font-mono text-muted-foreground">#{pr.number}</span>
                    <span class="truncate">{pr.title}</span>
                  </button>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    class="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Open in browser"
                    aria-label="Open in browser"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  {#if currentPr}
                    <Badge tone="accent" size="xs">current</Badge>
                  {/if}
                  {#if pr.isDraft}
                    <Badge tone="neutral" size="xs">draft</Badge>
                  {/if}
                  <button
                    type="button"
                    title="Toggle check details"
                    onclick={() => (expandedPr = expandedPr === pr.number ? undefined : pr.number)}
                  >
                    <Badge tone={checksTone(pr.checks)} size="xs">
                      {#if pr.checks.status === "passing"}
                        <Check size={11} />
                      {:else if pr.checks.status === "failing"}
                        <X size={11} />
                      {:else if pr.checks.status === "pending"}
                        <LoaderCircle size={11} class="animate-spin" />
                      {/if}
                      {pr.checks.status === "none" ? "no checks" : `${pr.checks.passed}/${pr.checks.total}`}
                    </Badge>
                  </button>
                  <span class="truncate font-mono text-xs text-muted-foreground">
                    {pr.baseRefName} ← {pr.headRefName}
                  </span>
                </div>
                {#if expandedPr === pr.number && pr.checks.runs.length > 0}
                  <div class="mt-1.5 flex flex-col gap-1 rounded-md border bg-background px-2 py-1.5">
                    {#each pr.checks.runs as run}
                      <div class="flex items-center gap-1.5 text-xs">
                        <span class="font-mono text-muted-foreground">{run.status}</span>
                        <span class="truncate text-foreground">{run.name}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </GitSection>
    </Card>
  {/if}
</div>

<ConfirmDialog
  bind:open={discardDialogOpen}
  title="Discard change?"
  description={discardCandidate
    ? `This will permanently discard all uncommitted changes for ${discardCandidate.file.path}.`
    : "This will permanently discard this uncommitted change."}
  confirmLabel="Discard"
  destructive
  onConfirm={confirmDiscard}
  onCancel={() => (discardCandidate = undefined)}
/>
