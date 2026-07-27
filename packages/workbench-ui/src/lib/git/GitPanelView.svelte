<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  PanelBanner,
  PanelToolbar,
  PanelToolbarButton,
  PanelToolbarGroup,
  PanelView,
} from "@nervekit/workbench-ui/panel";
import GitChangesSection from "./GitChangesSection.svelte";
import GitPrFilterDialog from "./GitPrFilterDialog.svelte";
import GitPrSection from "./GitPrSection.svelte";
import GitRepoBranchSection from "./GitRepoBranchSection.svelte";
import {
  filterAndSortBranches,
  gitFileGroups,
  limitPullRequests,
} from "./git-panel-controller.js";
import {
  defaultGitPanelSectionState,
  type GitPanelActions,
  type GitPanelModel,
  type GitPanelSectionState,
} from "./git-panel-types.js";
import {
  basePullDisabled,
  pullDisabled,
  pushDisabled,
  remoteActionDisabled,
  showPull,
  showPush,
  syncDisabled,
} from "./git-remote-actions";

let {
  model,
  actions,
  sectionState = defaultGitPanelSectionState,
  onSectionOpenChange,
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
  sectionState?: GitPanelSectionState;
  onSectionOpenChange?: (
    section: keyof GitPanelSectionState,
    open: boolean,
  ) => void;
} = $props();
let branchDialogOpen = $state(false);
let prFilterDialogOpen = $state(false);
let branchFilter = $state("");
let newBranchName = $state("");
let expandedPr = $state<number | undefined>(undefined);
let discardCandidate = $state<
  | {
      repository: string;
      file: NonNullable<GitPanelModel["changes"]>["files"][number];
    }
  | undefined
>(undefined);

const fileGroups = $derived(gitFileGroups(model.changes?.files ?? []));
const filteredBranches = $derived(
  filterAndSortBranches(
    model.branches,
    branchFilter,
    model.repositorySummary?.baseBranch,
  ),
);
const baseBranchSummary = $derived(
  model.branches.find(
    (branch) => branch.name === model.repositorySummary?.baseBranch,
  ),
);
const currentBranchName = $derived(
  model.repositorySummary?.currentBranch ?? null,
);
const displayedPullRequests = $derived(limitPullRequests(model.pullRequests));
const selectedRepoHasGithubRemote = $derived(
  Boolean(
    model.repositorySummary?.hasRemote &&
    model.repositorySummary.hasGithubRemote,
  ),
);

const remoteBusy = $derived(
  model.operations.fetching ||
    model.operations.pulling ||
    model.operations.pushing ||
    model.operations.syncing ||
    model.operations.switchingBaseAndPulling,
);

function resetRepositoryUi(): void {
  branchFilter = "";
  newBranchName = "";
  expandedPr = undefined;
  prFilterDialogOpen = false;
}

function selectRepository(repository: string): void {
  if (repository === model.selectedRepository) return;
  resetRepositoryUi();
  void actions.selectRepository(repository);
}

async function switchBranch(
  repository: string,
  branch: (typeof model.branches)[number],
): Promise<void> {
  const switched = await actions.switchBranch(repository, branch);
  if (switched === false) return;
  branchDialogOpen = false;
  branchFilter = "";
  newBranchName = "";
}

async function createBranch(repository: string): Promise<void> {
  const name = newBranchName.trim();
  if (!name) return;
  const created = await actions.createBranch(repository, name);
  if (created === false) return;
  branchDialogOpen = false;
  branchFilter = "";
  newBranchName = "";
}

function selectExpandedPullRequest(number: number | undefined): void {
  expandedPr = number;
  void actions.selectPullRequest(number);
}

function openBranchDialog(): void {
  branchDialogOpen = true;
  branchFilter = "";
  newBranchName = "";
  void actions.refreshBranches(model.selectedRepository);
}
</script>

<PanelView padded={false}>
  {#snippet toolbar()}
    {#if model.availability.available && model.repositorySummary}
      {@const repo = model.repositorySummary}
      <PanelToolbar>
        <PanelToolbarButton
          icon={CloudDownload}
          label="Fetch"
          showLabel
          title={repo.hasRemote
            ? "Fetch from remote and prune deleted refs"
            : "Add a remote before fetching"}
          loading={model.operations.fetching}
          disabled={!model.capabilities.remote.fetch.enabled ||
            remoteActionDisabled(repo, remoteBusy)}
          onclick={() =>
            void actions.runRemoteOperation(model.selectedRepository, "fetch")}
        />
        {#if showPull(repo)}
          <PanelToolbarButton
            icon={ArrowDown}
            label={`Pull${(repo.behind ?? 0) > 0 ? ` (${repo.behind})` : ""}`}
            showLabel
            title={repo.dirty
              ? "Commit or stash changes before pulling"
              : "Pull current branch with fast-forward only"}
            loading={model.operations.pulling}
            disabled={!model.capabilities.remote.pull.enabled ||
              pullDisabled(repo, remoteBusy)}
            onclick={() =>
              void actions.runRemoteOperation(model.selectedRepository, "pull")}
          />
        {/if}
        {#if showPush(repo)}
          <PanelToolbarButton
            icon={ArrowUp}
            label={`Push${(repo.ahead ?? 0) > 0 ? ` (${repo.ahead})` : ""}`}
            showLabel
            title="Push current branch"
            loading={model.operations.pushing}
            disabled={!model.capabilities.remote.push.enabled ||
              pushDisabled(repo, remoteBusy)}
            onclick={() =>
              void actions.runRemoteOperation(model.selectedRepository, "push")}
          />
        {/if}
        <PanelToolbarButton
          icon={RefreshCw}
          label="Sync"
          showLabel
          title={!repo.hasRemote
            ? "Add a remote before syncing"
            : repo.detached
              ? "Check out a branch before syncing"
              : "Fetch, then pull and push the current branch when needed"}
          loading={model.operations.syncing}
          disabled={!model.capabilities.remote.sync.enabled ||
            syncDisabled(repo, remoteBusy)}
          onclick={() =>
            void actions.runRemoteOperation(model.selectedRepository, "sync")}
        />
        {#if !repo.detached && !repo.onBaseBranch}
          <PanelToolbarButton
            icon={GitCompareArrows}
            label={`Switch to ${repo.baseBranch} and pull`}
            title={repo.dirty
              ? "Commit or stash changes before switching branches"
              : `Switch to ${repo.baseBranch} and pull with fast-forward only`}
            loading={model.operations.switchingBaseAndPulling}
            disabled={!model.capabilities.remote["switch-base-and-pull"]
              .enabled || basePullDisabled(repo, remoteBusy)}
            onclick={() =>
              void actions.runRemoteOperation(
                model.selectedRepository,
                "switch-base-and-pull",
              )}
          />
        {/if}
        <PanelToolbarGroup trailing>
          <PanelToolbarButton
            icon={RefreshCw}
            label="Refresh Git status"
            loading={model.refreshing}
            disabled={!model.capabilities.refresh.enabled || model.refreshing}
            onclick={() =>
              void actions.refreshRepository(model.selectedRepository)}
          />
        </PanelToolbarGroup>
      </PanelToolbar>
    {/if}
  {/snippet}

  {#snippet banner()}
    {#if !model.availability.available}
      <PanelBanner tone="muted">{model.availability.message}</PanelBanner>
    {:else if model.cachedError && model.repositories.length === 0}
      <PanelBanner tone="destructive" icon={TriangleAlert}>
        {model.cachedError}
      </PanelBanner>
    {:else if model.cachedError}
      <PanelBanner tone="warning" icon={TriangleAlert}>
        Using cached Git data. Refresh failed: {model.cachedError}
      </PanelBanner>
    {:else if model.initialLoading}
      <PanelBanner tone="muted">Loading Git repositories…</PanelBanner>
    {:else if model.repositories.length === 0}
      <PanelBanner tone="muted">
        {model.emptyMessage ?? "No Git repositories found."}
      </PanelBanner>
    {/if}
  {/snippet}

  {#if model.availability.available && model.repositories.length > 0}
    <GitRepoBranchSection
      repoSummary={model.repositorySummary}
      repos={[...model.repositories]}
      selectedRepo={model.selectedRepository}
      {filteredBranches}
      loadingBranches={model.loadingBranches}
      switchingBranch={model.operations.switchingBranch}
      creatingBranch={model.operations.creatingBranch}
      capabilities={model.capabilities}
      bind:branchFilter
      bind:newBranchName
      bind:branchDialogOpen
      {baseBranchSummary}
      open={sectionState.repository}
      onOpenChange={(open) => onSectionOpenChange?.("repository", open)}
      onSelectRepo={selectRepository}
      onOpenBranchDialog={openBranchDialog}
      onSwitchBranch={(repository, branch) =>
        void switchBranch(repository, branch)}
      onCreateBranch={(repository) => void createBranch(repository)}
    />

    <GitChangesSection
      changes={model.changes}
      stagedFiles={fileGroups.staged}
      unstagedFiles={fileGroups.unstaged}
      fileMutation={model.operations.fileMutation}
      bulkMutation={model.operations.bulkMutation}
      selectedRepo={model.selectedRepository}
      loadingOverview={model.loadingOverview}
      capabilities={model.capabilities}
      open={sectionState.changes}
      onOpenChange={(open) => onSectionOpenChange?.("changes", open)}
      onMutateFile={(repository, file, action) =>
        void actions.mutateFile(repository, file, action)}
      onBulkStage={(repository, action) =>
        void actions.bulkMutateFiles(repository, action)}
      onRefresh={(repository) => void actions.refreshRepository(repository)}
      onRequestDiscard={(file) =>
        (discardCandidate = { repository: model.selectedRepository, file })}
    />

    <GitPrSection
      displayedPrs={displayedPullRequests}
      prs={[...model.pullRequests]}
      filters={model.pullRequestFilters}
      selectedRepoSummary={model.repositorySummary}
      github={model.github}
      {selectedRepoHasGithubRemote}
      loadingPrs={model.loadingPullRequests}
      {currentBranchName}
      capabilities={model.capabilities}
      {expandedPr}
      onExpandedPrChange={selectExpandedPullRequest}
      open={sectionState.pullRequests}
      onOpenChange={(open) => onSectionOpenChange?.("pullRequests", open)}
      onRefreshPrs={() =>
        void actions.refreshPullRequests(model.selectedRepository)}
      onOpenFilters={() => (prFilterDialogOpen = true)}
      onOpenPr={(number) =>
        void actions.openPullRequest(model.selectedRepository, number)}
    />
  {/if}
</PanelView>

<GitPrFilterDialog
  bind:open={prFilterDialogOpen}
  filters={model.pullRequestFilters}
  hasCurrentBranch={currentBranchName !== null}
  onApply={(filters) =>
    void actions.configurePullRequests(model.selectedRepository, filters)}
  onReset={() => void actions.resetPullRequestConfig(model.selectedRepository)}
/>

<ConfirmDialog
  open={Boolean(discardCandidate)}
  title="Discard change?"
  description={discardCandidate
    ? `This will permanently discard all uncommitted changes for ${discardCandidate.file.path}.`
    : "This will permanently discard this uncommitted change."}
  confirmLabel="Discard"
  destructive
  onConfirm={() => {
    const candidate = discardCandidate;
    discardCandidate = undefined;
    if (candidate)
      void actions.mutateFile(candidate.repository, candidate.file, "discard");
  }}
  onCancel={() => (discardCandidate = undefined)}
  onOpenChange={(open) => {
    if (!open) discardCandidate = undefined;
  }}
/>
