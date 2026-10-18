<script lang="ts">
import type { Component } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import Square from "@lucide/svelte/icons/square";
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
  PanelEmpty,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panels";
import GitChangesArea from "./GitChangesArea.svelte";
import GitRepoSwitcher from "./GitRepoSwitcher.svelte";
import GitStashDialog from "./GitStashDialog.svelte";
import { gitFileGroups, gitFilesInScope } from "./git-panel-controller.js";
import type {
  GitPanelActions,
  GitPanelModel,
  GitRemoteOperation,
} from "./git-panel-types.js";
import {
  activeRemoteOperation,
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
const cancellingIds = new SvelteSet<string>();
async function requestCancellation(id: string): Promise<void> {
  if (cancellingIds.has(id) || !actions.cancelOperation) return;
  cancellingIds.add(id);
  try {
    await actions.cancelOperation(id);
  } finally {
    cancellingIds.delete(id);
  }
}
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

{#snippet remoteButton(
  operation: GitRemoteOperation,
  icon: Component,
  label: string,
  title: string,
  disabled: boolean,
  loading: boolean,
)}
  {@const activity = activeRemoteOperation(
    model.activeOperations ?? [],
    model.selectedRepository,
    operation,
  )}
  {@const canStop = Boolean(
    activity?.actions.cancel &&
    actions.cancelOperation &&
    !cancellingIds.has(activity.id),
  )}
  <PanelToolbarButton
    icon={canStop ? Square : icon}
    {label}
    ariaLabel={canStop ? `Stop ${label.toLowerCase()}` : label}
    variant="outline"
    showLabel
    title={canStop
      ? `Stop ${label.toLowerCase()}. ${operation === "push" || operation === "sync" ? "Remote updates may already have completed." : "Completed steps are not undone."}`
      : title}
    loading={(loading || Boolean(activity)) && !canStop}
    disabled={activity ? !canStop : disabled}
    onclick={() => {
      if (activity) {
        if (canStop) void requestCancellation(activity.id).catch(() => {});
      } else if (!loading) {
        void actions.runRemoteOperation(model.selectedRepository, operation);
      }
    }}
  />
{/snippet}

<PanelView>
  {#snippet banner()}
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

    {#if model.availability.available && model.repositories.length > 0}
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
            {@render remoteButton(
              "fetch",
              CloudDownload,
              "Fetch",
              repo.hasRemote
                ? "Fetch from remote and prune deleted refs"
                : "Add a remote before fetching",
              !model.capabilities.remote.fetch.enabled ||
                remoteActionDisabled(repo, remoteBusy),
              model.operations.fetching,
            )}
            {@render remoteButton(
              "pull",
              ArrowDown,
              `Pull${(repo.behind ?? 0) > 0 ? ` (${repo.behind})` : ""}`,
              repo.dirty
                ? "Pull with local changes; Git stops if files would be overwritten"
                : "Pull current branch with fast-forward only",
              !model.capabilities.remote.pull.enabled ||
                pullDisabled(repo, remoteBusy) ||
                !showPull(repo),
              model.operations.pulling,
            )}
            {@render remoteButton(
              "push",
              ArrowUp,
              `Push${(repo.ahead ?? 0) > 0 ? ` (${repo.ahead})` : ""}`,
              "Push current branch",
              !model.capabilities.remote.push.enabled ||
                pushDisabled(repo, remoteBusy),
              model.operations.pushing,
            )}
            {@render remoteButton(
              "sync",
              RefreshCw,
              "Sync",
              !repo.hasRemote
                ? "Add a remote before syncing"
                : repo.detached
                  ? "Check out a branch before syncing"
                  : repo.dirty
                    ? "Sync with local changes; Git stops if files would be overwritten"
                    : "Fetch, then pull and push the current branch when needed",
              !model.capabilities.remote.sync.enabled ||
                syncDisabled(repo, remoteBusy),
              model.operations.syncing,
            )}
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
            {@render remoteButton(
              "switch-base-and-pull",
              GitCompareArrows,
              `${repo.baseBranch} + pull`,
              repo.dirty
                ? `Switch to ${repo.baseBranch} and pull with local changes; Git stops if files would be overwritten`
                : `Switch to ${repo.baseBranch} and pull with fast-forward only`,
              !model.capabilities.remote["switch-base-and-pull"].enabled ||
                repo.detached ||
                repo.onBaseBranch ||
                basePullDisabled(repo, remoteBusy),
              model.operations.switchingBaseAndPulling,
            )}
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
  {:else}
    <PanelEmpty
      title={!model.availability.available
        ? "Git unavailable"
        : model.initialLoading
          ? "Loading Git repositories…"
          : "No Git data available"}
      description={!model.availability.available
        ? model.availability.message
        : model.emptyMessage}
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
