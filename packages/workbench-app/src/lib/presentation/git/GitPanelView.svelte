<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  PanelHeader,
  PanelToolbar,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panel";
import GitChangesArea from "./GitChangesArea.svelte";
import GitPanelBanner from "./GitPanelBanner.svelte";
import GitRepositoryControls from "./GitRepositoryControls.svelte";
import {
  filterAndSortBranches,
  gitFileGroups,
} from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";
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
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

let branchDialogOpen = $state(false);
let branchFilter = $state("");
let newBranchName = $state("");
let discardCandidate = $state<
  | {
      repository: string;
      file: NonNullable<GitPanelModel["changes"]>["files"][number];
    }
  | undefined
>(undefined);

const fileGroups = $derived(gitFileGroups(model.changes?.files ?? []));
const changeCount = $derived(model.changes?.files.length ?? 0);
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
  resetRepositoryUi();
}

async function createBranch(repository: string): Promise<void> {
  const name = newBranchName.trim();
  if (!name) return;
  const created = await actions.createBranch(repository, name);
  if (created === false) return;
  branchDialogOpen = false;
  resetRepositoryUi();
}

function openBranchDialog(): void {
  branchDialogOpen = true;
  resetRepositoryUi();
  void actions.refreshBranches(model.selectedRepository);
}
</script>

<PanelView padded={false} scroll={false}>
  {#snippet banner()}<GitPanelBanner {model} />{/snippet}

  {#if model.availability.available && model.repositories.length > 0}
    <PanelHeader title="Git changes" count={changeCount}>
      {#snippet trailing()}
        <PanelToolbarButton
          icon={RefreshCw}
          label="Refresh Git changes"
          loading={model.refreshing}
          disabled={!model.capabilities.refresh.enabled || model.refreshing}
          onclick={() =>
            void actions.refreshRepository(model.selectedRepository)}
        />
      {/snippet}
    </PanelHeader>

    <GitRepositoryControls
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
      onSelectRepo={selectRepository}
      onOpenBranchDialog={openBranchDialog}
      onSwitchBranch={(repository, branch) =>
        void switchBranch(repository, branch)}
      onCreateBranch={(repository) => void createBranch(repository)}
    />

    {#if model.repositorySummary}
      {@const repo = model.repositorySummary}
      <PanelToolbar
        dense
        class="h-auto flex-wrap border-b-0 bg-transparent py-1.5"
      >
        <PanelToolbarButton
          icon={CloudDownload}
          label="Fetch"
          variant="outline"
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
            variant="outline"
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
            variant="outline"
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
          variant="outline"
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
            label={`${repo.baseBranch} + pull`}
            variant="outline"
            showLabel
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
      </PanelToolbar>
    {/if}

    <GitChangesArea
      changes={model.changes}
      stagedFiles={fileGroups.staged}
      unstagedFiles={fileGroups.unstaged}
      fileMutation={model.operations.fileMutation}
      bulkMutation={model.operations.bulkMutation}
      selectedRepo={model.selectedRepository}
      capabilities={model.capabilities}
      onMutateFile={(repository, file, action) =>
        void actions.mutateFile(repository, file, action)}
      onBulkStage={(repository, action) =>
        void actions.bulkMutateFiles(repository, action)}
      onRequestDiscard={(file) =>
        (discardCandidate = { repository: model.selectedRepository, file })}
    />
  {/if}
</PanelView>

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
