<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  PanelHeader,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panels";
import GitChangesArea from "./GitChangesArea.svelte";
import GitPanelBanner from "./GitPanelBanner.svelte";
import GitRepoSwitcher from "./GitRepoSwitcher.svelte";
import GitStashDialog from "./GitStashDialog.svelte";
import { gitFileGroups, gitFilesInScope } from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";
import {
  basePullDisabled,
  pullDisabled,
  pushDisabled,
  remoteActionDisabled,
  showPull,
  syncDisabled,
} from "./git-remote-actions";

let {
  model,
  actions,
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

let stashDialogOpen = $state(false);
let bulkMainOpen = $state(false);
const bulkRepositories = $derived(
  model.repositories.filter((repo) => repo.hasRemote),
);
const bulkBaseLabel = $derived(
  bulkRepositories.length > 0 &&
    bulkRepositories.every((repo) => repo.baseBranch === "main")
    ? "main + pull all"
    : "Base + pull all",
);
let discardCandidate = $state<
  | {
      kind: "file";
      repository: string;
      file: NonNullable<GitPanelModel["changes"]>["files"][number];
    }
  | {
      kind: "scope";
      repository: string;
      area: "staged" | "unstaged";
      path?: string;
      count: number;
    }
  | undefined
>(undefined);

const fileGroups = $derived(gitFileGroups(model.changes?.files ?? []));
const changeCount = $derived(model.changes?.files.length ?? 0);

const remoteBusy = $derived(
  model.operations.fetching ||
    model.operations.pulling ||
    model.operations.pushing ||
    model.operations.syncing ||
    model.operations.switchingBaseAndPulling,
);
</script>

<PanelView>
  {#snippet banner()}
    <GitPanelBanner {model} />
    {#if model.availability.available && model.repositories.length > 0}
      <PanelHeader title="Git changes" count={changeCount}>
        {#snippet trailing()}
          {#if model.repositories.length > 1 && actions.runBulkRemoteOperation}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Project actions"
                    title="Project actions"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  disabled={!model.capabilities.remote.fetch.enabled ||
                    bulkRepositories.length === 0}
                  onclick={() => void actions.runBulkRemoteOperation?.("fetch")}
                  >Fetch all</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  disabled={!model.capabilities.remote.pull.enabled ||
                    bulkRepositories.length === 0}
                  onclick={() => void actions.runBulkRemoteOperation?.("pull")}
                  >Pull all</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  disabled={!model.capabilities.remote["switch-base-and-pull"]
                    .enabled || bulkRepositories.length === 0}
                  onclick={() => (bulkMainOpen = true)}
                  >{bulkBaseLabel}</DropdownMenu.Item
                >
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
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

      <GitRepoSwitcher
        {model}
        {actions}
        layout="list"
        chipCount={(repo) => repo.changeCount}
      />
      {#if model.repositorySummary}
        {@const repo = model.repositorySummary}
        <div class="@container">
          <div
            class="grid grid-cols-2 gap-1 py-1.5 @xs:grid-cols-4"
            role="group"
            aria-label="Remote actions"
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
                void actions.runRemoteOperation(
                  model.selectedRepository,
                  "fetch",
                )}
            />
            <PanelToolbarButton
              icon={ArrowDown}
              label={`Pull${(repo.behind ?? 0) > 0 ? ` (${repo.behind})` : ""}`}
              variant="outline"
              showLabel
              title={repo.dirty
                ? "Pull with local changes; Git stops if files would be overwritten"
                : "Pull current branch with fast-forward only"}
              loading={model.operations.pulling}
              disabled={!model.capabilities.remote.pull.enabled ||
                pullDisabled(repo, remoteBusy) ||
                !showPull(repo)}
              onclick={() =>
                void actions.runRemoteOperation(
                  model.selectedRepository,
                  "pull",
                )}
            />
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
                void actions.runRemoteOperation(
                  model.selectedRepository,
                  "push",
                )}
            />
            <PanelToolbarButton
              icon={RefreshCw}
              label="Sync"
              variant="outline"
              showLabel
              title={!repo.hasRemote
                ? "Add a remote before syncing"
                : repo.detached
                  ? "Check out a branch before syncing"
                  : repo.dirty
                    ? "Sync with local changes; Git stops if files would be overwritten"
                    : "Fetch, then pull and push the current branch when needed"}
              loading={model.operations.syncing}
              disabled={!model.capabilities.remote.sync.enabled ||
                syncDisabled(repo, remoteBusy)}
              onclick={() =>
                void actions.runRemoteOperation(
                  model.selectedRepository,
                  "sync",
                )}
            />
          </div>
          <div
            class="grid grid-cols-2 gap-1 border-b pb-2"
            role="group"
            aria-label="Repository actions"
          >
            <PanelToolbarButton
              icon={ArchiveRestore}
              label={`Stashes (${model.stashes.length})`}
              variant="outline"
              showLabel
              title="Manage stashes"
              disabled={!model.capabilities.stashes.enabled}
              onclick={() => (stashDialogOpen = true)}
            />
            <PanelToolbarButton
              icon={GitCompareArrows}
              label={`${repo.baseBranch} + pull`}
              variant="outline"
              showLabel
              title={repo.dirty
                ? `Switch to ${repo.baseBranch} and pull with local changes; Git stops if files would be overwritten`
                : `Switch to ${repo.baseBranch} and pull with fast-forward only`}
              loading={model.operations.switchingBaseAndPulling}
              disabled={!model.capabilities.remote["switch-base-and-pull"]
                .enabled ||
                repo.detached ||
                repo.onBaseBranch ||
                basePullDisabled(repo, remoteBusy)}
              onclick={() =>
                void actions.runRemoteOperation(
                  model.selectedRepository,
                  "switch-base-and-pull",
                )}
            />
          </div>
        </div>
      {/if}
    {/if}
  {/snippet}

  {#if model.availability.available && model.repositories.length > 0}
    <GitChangesArea
      changes={model.changes}
      stagedFiles={fileGroups.staged}
      unstagedFiles={fileGroups.unstaged}
      fileMutation={model.operations.fileMutation}
      bulkMutation={model.operations.bulkMutation}
      stashMutation={model.operations.stashMutation}
      collapsedFolders={model.collapsedChangeTreeFolders}
      selectedRepo={model.selectedRepository}
      capabilities={model.capabilities}
      onOpenDiff={(repository, file, area) =>
        void actions.openDiff(repository, file, area)}
      onMutateFile={(repository, file, action) =>
        void actions.mutateFile(repository, file, action)}
      onMutateScope={(repository, area, action, path) =>
        void actions.mutateFileScope(repository, area, action, path)}
      onCreateStash={(repository, area, path) =>
        void actions.createStash(repository, area, path)}
      onFolderExpansionChange={(repository, key, expanded) =>
        void actions.setChangeTreeFolderExpanded(repository, key, expanded)}
      onRequestDiscard={(file) =>
        (discardCandidate = {
          kind: "file",
          repository: model.selectedRepository,
          file,
        })}
      onRequestDiscardScope={(area, path) =>
        (discardCandidate = {
          kind: "scope",
          repository: model.selectedRepository,
          area,
          ...(path ? { path } : {}),
          count: gitFilesInScope(model.changes?.files ?? [], area, path).length,
        })}
    />
  {/if}
</PanelView>

<GitStashDialog
  bind:open={stashDialogOpen}
  repositoryName={model.repositorySummary?.name ?? model.selectedRepository}
  stashes={model.stashes}
  mutation={model.operations.stashMutation}
  onApply={(stash) => void actions.applyStash(model.selectedRepository, stash)}
  onDrop={(stash) => void actions.dropStash(model.selectedRepository, stash)}
/>

<ConfirmDialog
  open={Boolean(discardCandidate)}
  title="Discard change?"
  description={discardCandidate
    ? discardCandidate.kind === "file"
      ? `This will permanently discard all uncommitted changes for ${discardCandidate.file.path}.`
      : discardCandidate.path
        ? `This will permanently discard ${discardCandidate.count} changed ${discardCandidate.count === 1 ? "file" : "files"} in ${discardCandidate.path}.`
        : `This will permanently discard all ${discardCandidate.count} ${discardCandidate.area} ${discardCandidate.count === 1 ? "change" : "changes"}.`
    : "This will permanently discard this uncommitted change."}
  confirmLabel="Discard"
  destructive
  onConfirm={() => {
    const candidate = discardCandidate;
    discardCandidate = undefined;
    if (!candidate) return;
    if (candidate.kind === "file")
      void actions.mutateFile(candidate.repository, candidate.file, "discard");
    else
      void actions.mutateFileScope(
        candidate.repository,
        candidate.area,
        "discard",
        candidate.path,
      );
  }}
  onCancel={() => (discardCandidate = undefined)}
  onOpenChange={(open) => {
    if (!open) discardCandidate = undefined;
  }}
/>

<ConfirmDialog
  bind:open={bulkMainOpen}
  title="Switch base branches and pull all?"
  description={`Switch each repository to its base branch and pull with fast-forward only: ${bulkRepositories.map((repo) => `${repo.name} (${repo.baseBranch})`).join(", ")}. Local changes are kept; Git stops if files would be overwritten. Each repository reports its result independently in Activity.`}
  confirmLabel="Switch and pull all"
  onConfirm={() =>
    void actions.runBulkRemoteOperation?.("switch-base-and-pull")}
/>
