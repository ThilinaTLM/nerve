<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type {
    AgentRecord,
    GitBranchSummary,
    GitFileChange,
    ProjectRecord,
  } from "$lib/api";
  import { Card } from "@nervekit/shared-ui/components/ui/card";
  import ConfirmDialog from "@nervekit/shared-ui/components/ui/confirm-dialog";
  import { hasPendingPrChecks } from "$lib/features/git/checks";
  import { openPrPane } from "$lib/features/git/state/pr-tabs.svelte";
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
    refreshPrs,
    selectGitProject,
    selectGitRepo,
    switchBaseAndPullGitRepo,
    syncGitRepo,
    switchGitRepoBranch,
  } from "$lib/features/git/state/git-panel.svelte";
  import {
    gitProjectStateKey,
    gitRepoStateKey,
  } from "$lib/core/state/state-keys";
  import GitChangesSection from "@nervekit/shared-ui/git/GitChangesSection.svelte";
  import GitPrSection from "@nervekit/shared-ui/git/GitPrSection.svelte";
  import GitRepoBranchSection from "@nervekit/shared-ui/git/GitRepoBranchSection.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeAgent?: AgentRecord;
  };

  const GIT_OVERVIEW_AUTO_REFRESH_MS = 5_000;
  const GITHUB_CHECKS_POLL_MS = 10_000;

  let { activeProject, activeAgent: _activeAgent }: Props = $props();

  let repoSectionOpen = $state(true);
  let changesSectionOpen = $state(true);
  let prsSectionOpen = $state(true);
  let branchPopoverOpen = $state(false);
  let branchFilter = $state("");
  let newBranchName = $state("");
  let expandedPr = $state<number | undefined>(undefined);
  let discardCandidate = $state<{ repo: string; file: GitFileChange } | undefined>(undefined);
  let discardDialogOpen = $state(false);

  const projectState = $derived(
    activeProject
      ? gitPanelState.projects[gitProjectStateKey(activeProject.id)]
      : undefined,
  );
  const repos = $derived(projectState?.repos ?? []);
  const selectedRepo = $derived(projectState?.selectedRepo ?? ".");
  const current = $derived(projectState?.repoStates[gitRepoStateKey(selectedRepo)]);
  const repoSummary = $derived(current?.repoSummary);
  const changes = $derived(current?.changes);
  const operations = $derived(current?.operations);
  const github = $derived(current?.github);
  const prs = $derived(current?.prs ?? []);
  const branches = $derived(current?.branches ?? []);
  const selectedRepoSummary = $derived(
    repoSummary ?? repos.find((repo) => repo.relativePath === selectedRepo),
  );
  const selectedRepoHasGithubRemote = $derived(
    Boolean(selectedRepoSummary?.hasRemote && selectedRepoSummary.hasGithubRemote),
  );
  const discoverError = $derived(projectState?.discoverError);
  const loadingRepos = $derived(projectState?.loadingRepos ?? false);
  const loadingInitialRepos = $derived(
    Boolean(activeProject && !projectState) ||
      loadingRepos ||
      Boolean(projectState?.reposRequestInFlight && !projectState.loaded && repos.length === 0),
  );
  const refreshingRepos = $derived(projectState?.refreshingRepos ?? false);
  const loadingOverview = $derived(current?.loadingOverview ?? false);
  const loadingPrs = $derived(current?.loadingPrs ?? false);
  const loadingBranches = $derived(current?.loadingBranches ?? false);
  const fetching = $derived(operations?.fetching ?? false);
  const pulling = $derived(operations?.pulling ?? false);
  const pushing = $derived(operations?.pushing ?? false);
  const syncing = $derived(operations?.syncing ?? false);
  const switchingBaseAndPulling = $derived(
    operations?.switchingBaseAndPulling ?? false,
  );
  const switchingBranch = $derived(operations?.switchingBranch);
  const creatingBranch = $derived(operations?.creatingBranch ?? false);
  const fileMutation = $derived(operations?.fileMutation);
  const bulkMutation = $derived(operations?.bulkMutation);
  const refreshing = $derived(
    refreshingRepos || (loadingOverview && Boolean(repoSummary || changes)),
  );

  const stagedFiles = $derived(changes?.files.filter((file) => file.staged) ?? []);
  const unstagedFiles = $derived(
    changes?.files.filter((file) => file.untracked || file.worktree !== " ") ?? [],
  );
  const currentBranchName = $derived(repoSummary?.currentBranch ?? null);
  const hasPendingChecks = $derived(hasPendingPrChecks(prs));
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

  function selectRepo(value: string) {
    if (!activeProject || value === selectedRepo) return;
    selectGitRepo(activeProject.id, value);
    branchFilter = "";
    newBranchName = "";
    expandedPr = undefined;
  }

  async function onFetch(repo: string) {
    if (!activeProject) return;
    await fetchGitRepo(activeProject.id, repo);
  }

  async function onPull(repo: string) {
    if (!activeProject) return;
    await pullGitRepo(activeProject.id, repo);
  }

  async function onPush(repo: string) {
    if (!activeProject) return;
    await pushGitRepo(activeProject.id, repo);
  }

  async function onSync(repo: string) {
    if (!activeProject) return;
    await syncGitRepo(activeProject.id, repo);
  }

  async function onSwitchBaseAndPull(repo: string) {
    if (!activeProject) return;
    await switchBaseAndPullGitRepo(activeProject.id, repo);
  }

  async function onSwitchBranch(repo: string, branch: GitBranchSummary) {
    if (!activeProject) return;
    const switched = await switchGitRepoBranch(activeProject.id, repo, branch);
    if (!switched) return;
    branchPopoverOpen = false;
    branchFilter = "";
    newBranchName = "";
  }

  async function onCreateBranch(repo: string) {
    if (!activeProject || newBranchName.trim().length === 0) return;
    const created = await createGitRepoBranch(activeProject.id, repo, newBranchName);
    if (!created) return;
    branchPopoverOpen = false;
    branchFilter = "";
    newBranchName = "";
  }

  async function mutateFile(
    repo: string,
    file: GitFileChange,
    action: "stage" | "unstage" | "discard",
  ) {
    if (!activeProject) return;
    await mutateGitFile(activeProject.id, repo, file, action);
  }

  async function bulkStage(repo: string, action: "stage-all" | "unstage-all") {
    if (!activeProject) return;
    await bulkStageGitFiles(activeProject.id, repo, action);
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

  function onRefreshPrs() {
    if (activeProject) void refreshPrs(activeProject.id, selectedRepo);
  }

  function onOpenPr(prNumber: number) {
    if (!activeProject) return;
    void openPrPane({
      projectId: activeProject.id,
      repo: selectedRepo,
      number: prNumber,
    });
  }

  let lastProjectId = $state<string | undefined>(undefined);
  $effect(() => {
    const project = activeProject;
    const projectId = project?.id;
    if (projectId === lastProjectId) return;
    lastProjectId = projectId;
    branchFilter = "";
    newBranchName = "";
    expandedPr = undefined;
    if (project) queueMicrotask(() => selectGitProject(project));
  });

  $effect(() => {
    const projectId = activeProject?.id;
    const repo = selectedRepo;
    const repoCount = repos.length;
    if (!projectId || repoCount === 0 || !repo) return;
    const intervalId = window.setInterval(
      () => autoRefreshGitOverview(projectId, repo),
      GIT_OVERVIEW_AUTO_REFRESH_MS,
    );
    return () => window.clearInterval(intervalId);
  });

  $effect(() => {
    if (!branchPopoverOpen || !activeProject || repos.length === 0) return;
    void refreshBranches(activeProject.id, selectedRepo);
  });

  $effect(() => {
    const projectId = activeProject?.id;
    const repo = selectedRepo;
    const repoCount = repos.length;
    const authenticated = github?.authenticated;
    const pendingChecks = hasPendingChecks;
    const hasGithubRemote = selectedRepoHasGithubRemote;
    if (
      !projectId ||
      repoCount === 0 ||
      !repo ||
      !hasGithubRemote ||
      !authenticated ||
      !pendingChecks
    )
      return;

    const refreshPendingPrs = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshPrs(projectId, repo, true);
    };

    refreshPendingPrs();
    const intervalId = window.setInterval(refreshPendingPrs, GITHUB_CHECKS_POLL_MS);
    return () => window.clearInterval(intervalId);
  });
</script>

<div class="p-2">
  {#if !activeProject}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      Select a project to inspect its git repositories.
    </p>
  {:else if discoverError && repos.length === 0}
    <Card class="gap-0 overflow-hidden p-0">
      <div class="px-3 py-3 text-xs text-destructive">{discoverError}</div>
    </Card>
  {:else if loadingInitialRepos}
    <div class="flex items-center justify-center gap-2 px-1 py-6 text-xs text-muted-foreground">
      <LoaderCircle size={13} class="animate-spin" /> Loading git repositories…
    </div>
  {:else if repos.length === 0}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      No git repositories found in this directory (searched up to 2 levels deep).
    </p>
  {:else}
    <div class="flex flex-col gap-2">
      {#if discoverError}
        <Card class="gap-0 overflow-hidden p-0">
          <div class="px-3 py-2 text-xs text-warning">Using cached Git data. Refresh failed: {discoverError}</div>
        </Card>
      {/if}
      <GitRepoBranchSection
        {repoSummary}
        {repos}
        {selectedRepo}
        {filteredBranches}
        {loadingBranches}
        {switchingBranch}
        {creatingBranch}
        {fetching}
        {pulling}
        {pushing}
        {syncing}
        {switchingBaseAndPulling}
        {refreshing}
        bind:branchFilter
        bind:newBranchName
        bind:branchPopoverOpen
        bind:open={repoSectionOpen}
        onSelectRepo={selectRepo}
        onSwitchBranch={onSwitchBranch}
        onCreateBranch={onCreateBranch}
        onFetch={onFetch}
        onPull={onPull}
        onPush={onPush}
        onSync={onSync}
        onSwitchBaseAndPull={onSwitchBaseAndPull}
      />

      <GitChangesSection
        {changes}
        {stagedFiles}
        {unstagedFiles}
        {fileMutation}
        {bulkMutation}
        {selectedRepo}
        {loadingOverview}
        bind:open={changesSectionOpen}
        onMutateFile={mutateFile}
        onBulkStage={bulkStage}
        onRequestDiscard={requestDiscard}
      />

      <GitPrSection
        {sortedPrs}
        {prs}
        {selectedRepoSummary}
        {github}
        {selectedRepoHasGithubRemote}
        {loadingPrs}
        {currentBranchName}
        bind:expandedPr
        bind:open={prsSectionOpen}
        onRefreshPrs={onRefreshPrs}
        onOpenPr={onOpenPr}
      />
    </div>
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
