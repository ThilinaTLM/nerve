<script lang="ts">
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
  import Check from "@lucide/svelte/icons/check";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CloudDownload from "@lucide/svelte/icons/cloud-download";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FileMinus from "@lucide/svelte/icons/file-minus";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FileQuestion from "@lucide/svelte/icons/file-question";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCcw from "@lucide/svelte/icons/refresh-ccw";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import X from "@lucide/svelte/icons/x";
  import { notify } from "$lib/notifications/notify.svelte";
  import {
    commitGitChanges,
    createGitBranch,
    createGithubPr,
    discoverGitRepos,
    fetchGit,
    getGitOverview,
    getGithubStatus,
    listMyGithubPrs,
    pullGit,
    pushGit,
    suggestGitBranchName,
    suggestGitCommitMessage,
    suggestGitPr,
    syncGitBase,
    type AgentRecord,
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
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { cn } from "$lib/utils.js";
  import { invalidateGit } from "../../../stores/workbench/git-context.svelte";
  import { openPrPane } from "../../../stores/workbench/pr-tabs.svelte";
  import { workbenchState } from "../../../stores/workbench/state.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeAgent?: AgentRecord;
  };

  type LoadOverviewOptions = {
    silent?: boolean;
    seedPrTitle?: boolean;
    onlyIfChanged?: boolean;
  };

  const GIT_OVERVIEW_AUTO_REFRESH_MS = 4_000;

  let { activeProject, activeAgent }: Props = $props();

  let repos = $state<GitRepoSummary[]>([]);
  let projectIsRepo = $state(true);
  let selectedRepo = $state(".");
  let overview = $state<GitOverviewResponse | undefined>(undefined);
  let github = $state<GithubStatusResponse | undefined>(undefined);
  let prs = $state<GithubPr[]>([]);

  let loadingOverview = $state(false);
  let loadingPrs = $state(false);
  let discoverError = $state<string | undefined>(undefined);
  let overviewRequestInFlight = false;
  let lastOverviewFingerprint: string | undefined;

  let branchName = $state("");
  let branchAlternatives = $state<string[]>([]);
  let suggestingBranch = $state(false);
  let creatingBranch = $state(false);

  let commitSubject = $state("");
  let commitBody = $state("");
  let stageAll = $state(true);
  let suggestingCommit = $state(false);
  let committing = $state(false);
  let syncing = $state(false);
  let pushing = $state(false);
  let pulling = $state(false);
  let fetching = $state(false);

  let prTitle = $state("");
  let prBody = $state("");
  let prDraft = $state(false);
  let suggestingPr = $state(false);
  let creatingPr = $state(false);
  let expandedPr = $state<number | undefined>(undefined);

  const gitMutationInProgress = $derived(
    creatingBranch || committing || syncing || pushing || pulling || fetching,
  );

  let repoCarousel = $state<HTMLDivElement | null>(null);

  function scrollRepos(direction: 1 | -1) {
    if (!repoCarousel) return;
    repoCarousel.scrollBy({
      left: direction * repoCarousel.clientWidth * 0.85,
      behavior: "smooth",
    });
  }

  // Keep the selected repo card centered in the carousel.
  $effect(() => {
    const target = selectedRepo;
    const carousel = repoCarousel;
    if (!carousel) return;
    const card = carousel.querySelector<HTMLElement>(
      `[data-repo="${CSS.escape(target)}"]`,
    );
    card?.scrollIntoView({ inline: "center", block: "nearest" });
  });

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
  }

  function repoBranchLabel(repo: GitRepoSummary): string {
    return repo.currentBranch ?? "(detached)";
  }

  function repoPathLabel(repo: GitRepoSummary): string {
    return repo.relativePath === "." ? "project root" : repo.relativePath;
  }

  function repoStatusLabel(repo: GitRepoSummary): string {
    if (!repo.dirty) return "clean";
    return `${repo.changeCount} ${repo.changeCount === 1 ? "change" : "changes"}`;
  }

  function repoStatusTone(repo: GitRepoSummary): BadgeTone {
    return repo.dirty ? "warn" : "good";
  }

  function repoSyncLabel(repo: GitRepoSummary): string {
    if (!repo.hasRemote) return "local";
    if (!repo.hasUpstream) return "no upstream";
    return `↑${repo.ahead ?? 0} ↓${repo.behind ?? 0}`;
  }

  function repoSyncTone(repo: GitRepoSummary): BadgeTone {
    if (!repo.hasRemote || !repo.hasUpstream) return "neutral";
    if ((repo.behind ?? 0) > 0) return "warn";
    if ((repo.ahead ?? 0) > 0) return "accent";
    return "neutral";
  }

  async function loadRepos(project: ProjectRecord) {
    discoverError = undefined;
    lastOverviewFingerprint = undefined;
    try {
      const result = await discoverGitRepos(project.id);
      repos = result.repos;
      projectIsRepo = result.projectIsRepo;
      const stored =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(repoStorageKey(project.id))
          : null;
      const fallback = result.repos[0]?.relativePath ?? ".";
      selectedRepo =
        stored && result.repos.some((r) => r.relativePath === stored)
          ? stored
          : fallback;
      if (result.repos.length > 0) {
        await Promise.all([loadOverview(), loadGithub()]);
      } else {
        overview = undefined;
        github = undefined;
        prs = [];
        lastOverviewFingerprint = undefined;
      }
    } catch (error) {
      discoverError = errorMessage(error);
      repos = [];
      overview = undefined;
      lastOverviewFingerprint = undefined;
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

  async function loadOverview(options: LoadOverviewOptions = {}) {
    if (!activeProject || repos.length === 0 || overviewRequestInFlight) return;
    const { silent = false, seedPrTitle = true, onlyIfChanged = false } = options;
    const projectId = activeProject.id;
    const repo = selectedRepo;
    overviewRequestInFlight = true;
    if (!silent) loadingOverview = true;
    try {
      const next = await getGitOverview(projectId, repo);
      if (activeProject?.id !== projectId || selectedRepo !== repo) return;
      mergeRepoSummary(next.repo);
      const fingerprint = overviewFingerprint(next);
      if (!onlyIfChanged || fingerprint !== lastOverviewFingerprint) {
        overview = next;
        if (seedPrTitle && !prTitle) {
          prTitle =
            next.recentCommits[0]?.subject ?? next.repo.currentBranch ?? "";
        }
      }
      lastOverviewFingerprint = fingerprint;
    } catch (error) {
      if (!silent) notify.error(`Git overview failed: ${errorMessage(error)}`);
    } finally {
      if (!silent) loadingOverview = false;
      overviewRequestInFlight = false;
    }
  }

  async function loadGithub() {
    if (!activeProject || repos.length === 0) return;
    try {
      github = await getGithubStatus(activeProject.id, selectedRepo);
      if (github.authenticated) {
        await loadPrs();
      } else {
        prs = [];
      }
    } catch (error) {
      github = {
        available: false,
        authenticated: false,
        login: null,
        reason: errorMessage(error),
      };
    }
  }

  async function loadPrs() {
    if (!activeProject) return;
    loadingPrs = true;
    try {
      prs = (await listMyGithubPrs(activeProject.id, selectedRepo)).prs;
    } catch (error) {
      notify.error(`Could not list PRs: ${errorMessage(error)}`);
    } finally {
      loadingPrs = false;
    }
  }

  function selectRepo(value: string) {
    selectedRepo = value;
    if (activeProject && typeof localStorage !== "undefined") {
      localStorage.setItem(repoStorageKey(activeProject.id), value);
    }
    branchName = "";
    branchAlternatives = [];
    lastOverviewFingerprint = undefined;
    void loadOverview();
    void loadGithub();
  }

  async function onSuggestBranch() {
    if (!activeProject) return;
    suggestingBranch = true;
    try {
      const result = await suggestGitBranchName(
        activeProject.id,
        selectedRepo,
        activeAgent?.id,
      );
      branchName = result.suggestion;
      branchAlternatives = result.alternatives;
    } catch (error) {
      notify.error(`Suggestion failed: ${errorMessage(error)}`);
    } finally {
      suggestingBranch = false;
    }
  }

  async function onCreateBranch() {
    if (!activeProject || branchName.trim().length === 0) return;
    creatingBranch = true;
    try {
      const result = await createGitBranch(
        activeProject.id,
        selectedRepo,
        branchName.trim(),
      );
      mergeRepoSummary(result.repo);
      notify.success(`Created branch ${branchName.trim()}`);
      branchName = "";
      branchAlternatives = [];
      invalidateGit(activeProject.id);
    } catch (error) {
      notify.error(`Create branch failed: ${errorMessage(error)}`);
    } finally {
      creatingBranch = false;
    }
  }

  async function onSuggestCommit() {
    if (!activeProject) return;
    suggestingCommit = true;
    try {
      const result = await suggestGitCommitMessage(
        activeProject.id,
        selectedRepo,
        activeAgent?.id,
      );
      commitSubject = result.subject;
      commitBody = result.body ?? "";
    } catch (error) {
      notify.error(`Suggestion failed: ${errorMessage(error)}`);
    } finally {
      suggestingCommit = false;
    }
  }

  async function onCommit() {
    if (!activeProject || commitSubject.trim().length === 0) return;
    committing = true;
    try {
      const result = await commitGitChanges(activeProject.id, selectedRepo, {
        subject: commitSubject.trim(),
        body: commitBody.trim() || undefined,
        all: stageAll,
      });
      mergeRepoSummary(result.repo);
      notify.success(`Committed ${result.hash}`);
      commitSubject = "";
      commitBody = "";
      invalidateGit(activeProject.id);
    } catch (error) {
      notify.error(`Commit failed: ${errorMessage(error)}`);
    } finally {
      committing = false;
    }
  }

  async function onSyncBase() {
    if (!activeProject) return;
    syncing = true;
    try {
      const result = await syncGitBase(activeProject.id, selectedRepo);
      mergeRepoSummary(result.repo);
      notify.success(`Switched to ${result.repo.currentBranch ?? "base"}`);
      invalidateGit(activeProject.id);
    } catch (error) {
      notify.error(`Sync failed: ${errorMessage(error)}`);
    } finally {
      syncing = false;
    }
  }

  async function onFetch() {
    if (!activeProject) return;
    fetching = true;
    try {
      const result = await fetchGit(activeProject.id, selectedRepo);
      mergeRepoSummary(result.repo);
      notify.success("Fetched from remote");
      invalidateGit(activeProject.id);
    } catch (error) {
      notify.error(`Fetch failed: ${errorMessage(error)}`);
    } finally {
      fetching = false;
    }
  }

  async function onPull() {
    if (!activeProject) return;
    pulling = true;
    try {
      const result = await pullGit(activeProject.id, selectedRepo);
      mergeRepoSummary(result.repo);
      notify.success("Pulled latest changes");
      invalidateGit(activeProject.id);
    } catch (error) {
      notify.error(`Pull failed: ${errorMessage(error)}`);
    } finally {
      pulling = false;
    }
  }

  async function onPush() {
    if (!activeProject) return;
    pushing = true;
    try {
      const result = await pushGit(activeProject.id, selectedRepo);
      mergeRepoSummary(result.repo);
      notify.success("Pushed to remote");
      invalidateGit(activeProject.id);
    } catch (error) {
      notify.error(`Push failed: ${errorMessage(error)}`);
    } finally {
      pushing = false;
    }
  }

  async function onSuggestPr() {
    if (!activeProject) return;
    suggestingPr = true;
    try {
      const result = await suggestGitPr(
        activeProject.id,
        selectedRepo,
        activeAgent?.id,
      );
      prTitle = result.title;
      prBody = result.body ?? "";
    } catch (error) {
      notify.error(`Suggestion failed: ${errorMessage(error)}`);
    } finally {
      suggestingPr = false;
    }
  }

  async function onCreatePr() {
    if (!activeProject || prTitle.trim().length === 0) return;
    creatingPr = true;
    try {
      const result = await createGithubPr(activeProject.id, selectedRepo, {
        title: prTitle.trim(),
        body: prBody.trim() || undefined,
        base: overview?.baseBranch,
        draft: prDraft,
      });
      notify.success(`Opened PR #${result.number}`);
      prBody = "";
      invalidateGit(activeProject.id);
      await loadPrs();
    } catch (error) {
      notify.error(`Create PR failed: ${errorMessage(error)}`);
    } finally {
      creatingPr = false;
    }
  }

  function fileIcon(file: GitFileChange) {
    if (file.untracked) return FileQuestion;
    if (file.index === "A") return FilePlus;
    if (file.index === "D" || file.worktree === "D") return FileMinus;
    return FilePen;
  }

  function fileTone(file: GitFileChange): string {
    if (file.untracked) return "text-muted-foreground";
    if (file.index === "A") return "text-success";
    if (file.index === "D" || file.worktree === "D") return "text-destructive";
    return "text-info";
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

  const dirtyOverview = $derived(overview && overview.files.length > 0);

  function autoRefreshOverview() {
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    if (overviewRequestInFlight || gitMutationInProgress) return;
    void loadOverview({
      silent: true,
      seedPrTitle: false,
      onlyIfChanged: true,
    });
  }

  // Poll local git state while the Git tab is mounted and visible.
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

  // Reload when the active project changes.
  let lastProjectId = $state<string | undefined>(undefined);
  $effect(() => {
    if (activeProject && activeProject.id !== lastProjectId) {
      lastProjectId = activeProject.id;
      void loadRepos(activeProject);
    } else if (!activeProject) {
      lastProjectId = undefined;
      repos = [];
      overview = undefined;
      lastOverviewFingerprint = undefined;
    }
  });

  // Reload when an external git mutation (e.g. PR checkout) invalidates state.
  let lastGitRefreshToken = workbenchState.gitRefreshToken;
  $effect(() => {
    const token = workbenchState.gitRefreshToken;
    if (token === lastGitRefreshToken) return;
    lastGitRefreshToken = token;
    if (activeProject && repos.length > 0) {
      void loadOverview();
      void loadGithub();
    }
  });
</script>

<div class="flex flex-col gap-2 p-2">
  {#if !activeProject}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      Select a project to manage its git repositories.
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
    {#if !projectIsRepo}
      <Card class="gap-0 overflow-hidden p-0">
        <div class="flex items-center justify-between border-b px-3 py-2">
          <span class="text-xs font-semibold text-foreground">Repository</span>
          <div class="flex items-center gap-1">
            <span class="mr-1 text-[11px] text-muted-foreground">
              {repos.length} {repos.length === 1 ? "repo" : "repos"}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              ariaLabel="Scroll to previous repositories"
              onclick={() => scrollRepos(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              ariaLabel="Scroll to next repositories"
              onclick={() => scrollRepos(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div
          bind:this={repoCarousel}
          role="radiogroup"
          aria-label="Select repository"
          class="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {#each repos as repo (repo.relativePath)}
            {@const active = repo.relativePath === selectedRepo}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              data-repo={repo.relativePath}
              onclick={() => selectRepo(repo.relativePath)}
              class={cn(
                "flex w-[85%] shrink-0 snap-center flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-primary/50 bg-accent"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <div class="flex min-w-0 items-center gap-2">
                {#if active}
                  <Check size={13} strokeWidth={2.4} class="shrink-0 text-primary" />
                {/if}
                <span class="truncate text-sm font-medium text-foreground">
                  {repo.name}
                </span>
                <Badge tone={repoStatusTone(repo)} size="xs" class="ml-auto shrink-0">
                  {repoStatusLabel(repo)}
                </Badge>
              </div>
              <div class="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span class="truncate">{repoPathLabel(repo)}</span>
                <span class="shrink-0">·</span>
                <GitBranch size={11} strokeWidth={2.2} class="shrink-0" />
                <span class="truncate font-mono text-foreground">
                  {repoBranchLabel(repo)}
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <Badge tone={repoSyncTone(repo)} size="xs">
                  {repoSyncLabel(repo)}
                </Badge>
                {#if repo.onBaseBranch}
                  <Badge tone="neutral" size="xs">base</Badge>
                {/if}
                {#if repo.detached}
                  <Badge tone="warn" size="xs">detached</Badge>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </Card>
    {/if}

    <!-- Changes overview -->
    <Card class="gap-0 overflow-hidden p-0">
      <div class="flex items-center justify-between border-b px-3 py-2">
        <span class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <GitBranch size={13} strokeWidth={2.2} />
          Changes
        </span>
        <div class="flex items-center gap-0.5">
          {#if overview}
            {#if overview.repo.hasRemote}
              <Button
                size="icon-xs"
                variant="ghost"
                ariaLabel="Fetch"
                title="Fetch from remote"
                disabled={fetching}
                onclick={() => void onFetch()}
              >
                {#if fetching}
                  <LoaderCircle class="animate-spin" />
                {:else}
                  <CloudDownload />
                {/if}
              </Button>
            {/if}
            {#if overview.repo.hasUpstream && (overview.repo.behind ?? 0) > 0}
              <Button
                size="icon-xs"
                variant="ghost"
                ariaLabel="Pull"
                title={`Pull ${overview.repo.behind} commit(s)`}
                disabled={pulling || dirtyOverview}
                onclick={() => void onPull()}
              >
                {#if pulling}
                  <LoaderCircle class="animate-spin" />
                {:else}
                  <ArrowDownToLine />
                {/if}
              </Button>
            {/if}
            {#if !overview.repo.detached && ((overview.repo.ahead ?? 0) > 0 || !overview.repo.hasUpstream)}
              <Button
                size="icon-xs"
                variant="ghost"
                ariaLabel="Push"
                title={overview.repo.hasUpstream ? `Push ${overview.repo.ahead} commit(s)` : "Push and set upstream"}
                disabled={pushing}
                onclick={() => void onPush()}
              >
                {#if pushing}
                  <LoaderCircle class="animate-spin" />
                {:else}
                  <ArrowUpFromLine />
                {/if}
              </Button>
            {/if}
            {#if !overview.onBaseBranch}
              <Button
                size="icon-xs"
                variant="ghost"
                ariaLabel="Switch to base branch and pull"
                title={`Switch to ${overview.baseBranch} & pull`}
                disabled={syncing || dirtyOverview}
                onclick={() => void onSyncBase()}
              >
                {#if syncing}
                  <LoaderCircle class="animate-spin" />
                {:else}
                  <RefreshCcw />
                {/if}
              </Button>
            {/if}
          {/if}
        </div>
      </div>
      {#if overview}
        <div class="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
          <Badge tone="accent" size="sm" class="font-mono">
            {overview.repo.currentBranch ?? "(detached)"}
          </Badge>
          {#if overview.onBaseBranch}
            <Badge tone="neutral" size="sm">base</Badge>
          {/if}
          {#if overview.repo.hasUpstream}
            <Badge tone="neutral" size="sm">↑{overview.repo.ahead ?? 0} ↓{overview.repo.behind ?? 0}</Badge>
          {/if}
          {#if overview.insertions || overview.deletions}
            <span class="font-mono text-xs">
              <span class="text-success">+{overview.insertions}</span>
              <span class="text-destructive">−{overview.deletions}</span>
            </span>
          {/if}
        </div>
        <div class="px-3 pb-1 text-xs text-muted-foreground">
          {overview.stagedCount} staged · {overview.unstagedCount} unstaged · {overview.untrackedCount} untracked
        </div>
        <div class="max-h-48 overflow-y-auto px-3 py-1.5">
          {#if overview.files.length === 0}
            <p class="py-2 text-xs text-muted-foreground">Working tree clean.</p>
          {/if}
          {#each overview.files as file (file.path)}
            {@const Icon = fileIcon(file)}
            <div class="flex items-center gap-2 py-0.5">
              <Icon size={13} strokeWidth={2.2} class={fileTone(file)} />
              <span class="truncate font-mono text-xs text-foreground" title={file.path}>
                {file.path}
              </span>
              {#if file.staged}
                <Check size={12} class="ml-auto shrink-0 text-success" />
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
      {/if}
    </Card>

    <!-- Branch creation (always available) -->
    {#if overview}
      <Card class="gap-0 overflow-hidden p-0">
        <div class="border-b px-3 py-2 text-xs font-semibold text-foreground">New branch</div>
        <div class="flex flex-col gap-2 px-3 py-2.5">
          <div class="flex gap-1.5">
            <Input bind:value={branchName} placeholder="feature/branch-name" class="h-8 font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              ariaLabel="Suggest branch name"
              disabled={suggestingBranch}
              onclick={() => void onSuggestBranch()}
            >
              {#if suggestingBranch}
                <LoaderCircle class="animate-spin" />
              {:else}
                <Sparkles />
              {/if}
              Suggest
            </Button>
          </div>
          {#if branchAlternatives.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each branchAlternatives as alt}
                <button
                  type="button"
                  class="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/60"
                  onclick={() => (branchName = alt)}
                >
                  {alt}
                </button>
              {/each}
            </div>
          {/if}
          <Button
            size="sm"
            disabled={creatingBranch || branchName.trim().length === 0}
            onclick={() => void onCreateBranch()}
          >
            <GitBranch />
            Create branch
          </Button>
        </div>
      </Card>
    {/if}

    <!-- Commit (only when there are changes) -->
    {#if dirtyOverview}
    <Card class="gap-0 overflow-hidden p-0">
      <div class="border-b px-3 py-2 text-xs font-semibold text-foreground">Commit</div>
      <div class="flex flex-col gap-2 px-3 py-2.5">
        <div class="flex gap-1.5">
          <Input bind:value={commitSubject} placeholder="Commit subject" class="h-8 text-xs" />
          <Button
            size="sm"
            variant="outline"
            ariaLabel="Suggest commit message"
            disabled={suggestingCommit || !dirtyOverview}
            onclick={() => void onSuggestCommit()}
          >
            {#if suggestingCommit}
              <LoaderCircle class="animate-spin" />
            {:else}
              <Sparkles />
            {/if}
            Suggest
          </Button>
        </div>
        <Textarea bind:value={commitBody} placeholder="Extended description (optional)" class="min-h-16 text-xs" />
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox bind:checked={stageAll} />
          Stage all changes
        </label>
        <Button
          size="sm"
          disabled={committing || commitSubject.trim().length === 0}
          onclick={() => void onCommit()}
        >
          <GitCommitHorizontal />
          Commit
        </Button>
      </div>
    </Card>
    {/if}

    <!-- GitHub -->
    <Card class="gap-0 overflow-hidden p-0">
      <div class="flex items-center justify-between border-b px-3 py-2">
        <span class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <GitPullRequest size={13} strokeWidth={2.2} />
          GitHub
        </span>
        {#if github?.authenticated}
          <Button
            size="icon-xs"
            variant="ghost"
            ariaLabel="Refresh PRs"
            disabled={loadingPrs}
            onclick={() => void loadPrs()}
          >
            <RefreshCw class={loadingPrs ? "animate-spin" : ""} />
          </Button>
        {/if}
      </div>

      {#if !github}
        <div class="px-3 py-3 text-xs text-muted-foreground">Checking GitHub CLI…</div>
      {:else if !github.available}
        <div class="px-3 py-3 text-xs text-muted-foreground">
          GitHub CLI (<code class="font-mono">gh</code>) is not installed.
        </div>
      {:else if !github.authenticated}
        <div class="px-3 py-3 text-xs text-muted-foreground">
          Not authenticated. Run <code class="font-mono">gh auth login</code>.
        </div>
      {:else}
        <div class="flex flex-col gap-2 border-b px-3 py-2.5">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            Signed in as <span class="font-mono text-foreground">{github.login}</span>
          </div>
          {#if overview?.repo.mergedToBase}
            <div class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              This branch appears to already be merged into
              <span class="font-mono text-foreground">{overview.baseBranch}</span>.
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={syncing || dirtyOverview}
              onclick={() => void onSyncBase()}
            >
              {#if syncing}
                <LoaderCircle class="animate-spin" />
              {:else}
                <RefreshCcw />
              {/if}
              Switch to {overview.baseBranch}
            </Button>
          {:else if !overview?.onBaseBranch}
            <div class="flex gap-1.5">
              <Input bind:value={prTitle} placeholder="PR title" class="h-8 text-xs" />
              <Button
                size="sm"
                variant="outline"
                ariaLabel="Suggest PR title and description"
                disabled={suggestingPr}
                onclick={() => void onSuggestPr()}
              >
                {#if suggestingPr}
                  <LoaderCircle class="animate-spin" />
                {:else}
                  <Sparkles />
                {/if}
                Suggest
              </Button>
            </div>
            <Textarea bind:value={prBody} placeholder="PR description (optional)" class="min-h-16 text-xs" />
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox bind:checked={prDraft} />
              Create as draft
            </label>
            <Button
              size="sm"
              disabled={creatingPr || prTitle.trim().length === 0}
              onclick={() => void onCreatePr()}
            >
              <GitPullRequest />
              Create PR
            </Button>
          {:else}
            <span class="text-xs text-muted-foreground">
              Create a branch and commit before opening a PR.
            </span>
          {/if}
        </div>

        <div class="flex flex-col">
          <div class="px-3 py-2 text-xs font-semibold text-muted-foreground">My open PRs</div>
          {#if loadingPrs}
            <div class="px-3 pb-3 text-xs text-muted-foreground">Loading…</div>
          {:else if prs.length === 0}
            <div class="px-3 pb-3 text-xs text-muted-foreground">No open PRs by you.</div>
          {:else}
            {#each prs as pr (pr.number)}
              <div class="border-t px-3 py-2">
                <div class="flex items-center gap-2">
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
                  {#if pr.isDraft}
                    <Badge tone="neutral" size="xs">draft</Badge>
                  {/if}
                  <button
                    type="button"
                    onclick={() => (expandedPr = expandedPr === pr.number ? undefined : pr.number)}
                  >
                    <Badge tone={checksTone(pr.checks)} size="xs">
                      {#if pr.checks.status === "passing"}
                        <Check size={11} />
                      {:else if pr.checks.status === "failing"}
                        <X size={11} />
                      {/if}
                      {pr.checks.status === "none" ? "no checks" : `${pr.checks.passed}/${pr.checks.total}`}
                    </Badge>
                  </button>
                </div>
                <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {pr.baseRefName} ← {pr.headRefName}
                </div>
                {#if expandedPr === pr.number && pr.checks.runs.length > 0}
                  <div class="mt-1.5 flex flex-col gap-1">
                    {#each pr.checks.runs as run}
                      <div class="flex items-center gap-1.5 text-[11px]">
                        <span class="font-mono text-muted-foreground">{run.status}</span>
                        <span class="truncate text-foreground">{run.name}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </Card>
  {/if}
</div>
