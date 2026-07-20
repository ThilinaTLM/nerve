<script lang="ts">
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Card } from "@nervekit/ui-kit/components/ui/card";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import GitChangesSection from "./GitChangesSection.svelte";
import GitPrFilterDialog from "./GitPrFilterDialog.svelte";
import GitPrSection from "./GitPrSection.svelte";
import GitRepoBranchSection from "./GitRepoBranchSection.svelte";
import {
  filterAndSortBranches,
  gitFileGroups,
  limitPullRequests,
} from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";

let { model, actions }: { model: GitPanelModel; actions: GitPanelActions } =
  $props();

let repoSectionOpen = $state(true);
let changesSectionOpen = $state(true);
let prsSectionOpen = $state(true);
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

<div class="p-2">
  {#if !model.availability.available}
    <p
      class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground"
    >
      {model.availability.message}
    </p>
  {:else if model.cachedError && model.repositories.length === 0}
    <Card class="gap-0 overflow-hidden p-0">
      <div class="px-3 py-3 text-xs text-destructive">{model.cachedError}</div>
    </Card>
  {:else if model.initialLoading}
    <div
      class="flex items-center justify-center gap-2 px-1 py-6 text-xs text-muted-foreground"
    >
      <Spinner class="size-3.5" /> Loading Git repositories…
    </div>
  {:else if model.repositories.length === 0}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">
      {model.emptyMessage ?? "No Git repositories found."}
    </p>
  {:else}
    <div class="flex flex-col gap-2">
      {#if model.cachedError}
        <Card class="gap-0 overflow-hidden p-0">
          <div class="px-3 py-2 text-xs text-warning">
            Using cached Git data. Refresh failed: {model.cachedError}
          </div>
        </Card>
      {/if}

      <GitRepoBranchSection
        repoSummary={model.repositorySummary}
        repos={[...model.repositories]}
        selectedRepo={model.selectedRepository}
        {filteredBranches}
        loadingBranches={model.loadingBranches}
        switchingBranch={model.operations.switchingBranch}
        creatingBranch={model.operations.creatingBranch}
        fetching={model.operations.fetching}
        pulling={model.operations.pulling}
        pushing={model.operations.pushing}
        syncing={model.operations.syncing}
        switchingBaseAndPulling={model.operations.switchingBaseAndPulling}
        refreshing={model.refreshing}
        capabilities={model.capabilities}
        bind:branchFilter
        bind:newBranchName
        bind:branchDialogOpen
        {baseBranchSummary}
        bind:open={repoSectionOpen}
        onSelectRepo={selectRepository}
        onOpenBranchDialog={openBranchDialog}
        onSwitchBranch={(repository, branch) =>
          void switchBranch(repository, branch)}
        onCreateBranch={(repository) => void createBranch(repository)}
        onFetch={(repository) =>
          void actions.runRemoteOperation(repository, "fetch")}
        onPull={(repository) =>
          void actions.runRemoteOperation(repository, "pull")}
        onPush={(repository) =>
          void actions.runRemoteOperation(repository, "push")}
        onSync={(repository) =>
          void actions.runRemoteOperation(repository, "sync")}
        onSwitchBaseAndPull={(repository) =>
          void actions.runRemoteOperation(repository, "switch-base-and-pull")}
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
        bind:open={changesSectionOpen}
        onMutateFile={(repository, file, action) =>
          void actions.mutateFile(repository, file, action)}
        onBulkStage={(repository, action) =>
          void actions.bulkMutateFiles(repository, action)}
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
        bind:open={prsSectionOpen}
        onRefreshPrs={() =>
          void actions.refreshPullRequests(model.selectedRepository)}
        onOpenFilters={() => (prFilterDialogOpen = true)}
        onOpenPr={(number) =>
          void actions.openPullRequest(model.selectedRepository, number)}
      />
    </div>
  {/if}
</div>

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
