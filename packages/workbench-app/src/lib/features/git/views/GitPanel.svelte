<script lang="ts">
import type { Activity } from "@nervekit/contracts/activity";
import type { GitRepoSummary, GitStashEntry } from "@nervekit/contracts/git";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SvelteSet } from "svelte/reactivity";
import Square from "@lucide/svelte/icons/square";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import GitBranch from "@lucide/svelte/icons/git-branch";
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
import { mergeProps } from "bits-ui";
import Check from "@lucide/svelte/icons/check";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
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
import GitPullRequestRow from "./GitPullRequestRow.svelte";
import GitRepoSwitcher from "./GitRepoSwitcher.svelte";
import GitStashDialog from "./GitStashDialog.svelte";
import { gitFileGroups, gitFilesInScope } from "./git-panel-controller.js";
import { repoButtonLabel } from "./git-change-format.js";
import type {
  GitPanelActions,
  GitPanelModel,
  GitRemoteOperation,
} from "./git-panel-types.js";
import {
  activeRemoteOperation,
  remoteOperationOf,
  repositoryRemoteBusy,
  runningRemoteActivity,
  syncSummary,
} from "./git-remote-actions";

let {
  model,
  actions,
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

let stashDialogOpen = $state(false);
type StashTarget = Pick<GitRepoSummary, "relativePath" | "absDir" | "name">;
let stashTarget = $state<StashTarget>();
let stashSnapshot = $state<readonly GitStashEntry[]>([]);
let stashMutation = $state<GitPanelModel["operations"]["stashMutation"]>();
let stashRequest = 0;
function isCurrentStashTarget(target: StashTarget): boolean {
  return model.repositories.some(
    (repo) =>
      repo.relativePath === target.relativePath &&
      repo.absDir === target.absDir,
  );
}
$effect(() => {
  if (stashTarget && !isCurrentStashTarget(stashTarget)) {
    stashRequest++;
    stashTarget = undefined;
    stashSnapshot = [];
    stashMutation = undefined;
    stashDialogOpen = false;
  }
});
async function openStashes(repo: GitRepoSummary): Promise<void> {
  const request = ++stashRequest;
  const target = {
    relativePath: repo.relativePath,
    absDir: repo.absDir,
    name: repo.name,
  };
  stashTarget = target;
  stashSnapshot = [];
  stashMutation = undefined;
  stashDialogOpen = false;
  const stashes = await actions.loadStashes(target.relativePath);
  if (request !== stashRequest || !isCurrentStashTarget(target) || !stashes)
    return;
  stashSnapshot = stashes;
  stashDialogOpen = true;
}
async function mutateStash(
  action: "apply" | "drop",
  stash: GitStashEntry,
): Promise<void> {
  const target = stashTarget;
  if (!target || !isCurrentStashTarget(target) || stashMutation) return;
  const request = stashRequest;
  stashMutation = { action, hash: stash.hash };
  try {
    if (action === "apply")
      await actions.applyStash(target.relativePath, stash);
    else await actions.dropStash(target.relativePath, stash);
    if (request !== stashRequest || !isCurrentStashTarget(target)) return;
    const stashes = await actions.loadStashes(target.relativePath);
    if (request === stashRequest && isCurrentStashTarget(target) && stashes)
      stashSnapshot = stashes;
  } finally {
    if (request === stashRequest) stashMutation = undefined;
  }
}
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
const totalChangeCount = $derived(
  model.repositories.reduce((sum, repo) => sum + repo.changeCount, 0),
);
let expandedPr = $state<number>();
let switcher = $state<ReturnType<typeof GitRepoSwitcher>>();

const icons = {
  fetch: CloudDownload,
  pull: ArrowDown,
  push: ArrowUp,
  sync: ArrowDownUp,
  "switch-base-and-pull": GitCompareArrows,
};
function actionLabel(
  repo: GitRepoSummary,
  operation: GitRemoteOperation,
): string {
  if (operation === "switch-base-and-pull")
    return `Switch to ${repo.baseBranch} and pull`;
  if (operation === "pull")
    return `Pull${repo.behind ? ` (${repo.behind})` : ""}`;
  if (operation === "push")
    return `Push${repo.ahead ? ` (${repo.ahead})` : ""}`;
  return operation === "fetch" ? "Fetch" : "Sync";
}
function rowState(repo: GitRepoSummary, operation: GitRemoteOperation) {
  const activity = activeRemoteOperation(
    model.activeOperations ?? [],
    repo.relativePath,
    operation,
  );
  const pending = Boolean(activity && cancellingIds.has(activity.id));
  const canStop = Boolean(
    activity?.actions.cancel && actions.cancelOperation && !pending,
  );
  const capability = model.capabilities.remote[operation];
  let reason = !capability.enabled ? capability.reason : "";
  if (
    !reason &&
    repositoryRemoteBusy(model.activeOperations ?? [], repo.relativePath)
  )
    reason = "Another operation is running in this repository.";
  if (!reason && !repo.hasRemote) reason = "Add a remote first.";
  if (!reason && operation !== "fetch" && repo.detached)
    reason = "Check out a branch first.";
  if (!reason && operation === "pull" && !repo.hasUpstream)
    reason = "Configure an upstream first.";
  if (!reason && operation === "pull" && !(repo.behind && repo.behind > 0))
    reason = "No incoming commits.";
  if (!reason && operation === "push" && !(repo.ahead && repo.ahead > 0))
    reason = "No outgoing commits.";
  if (!reason && operation === "switch-base-and-pull" && repo.onBaseBranch)
    reason = `Already on ${repo.baseBranch}.`;
  const descriptions = {
    fetch: "Fetch remote updates without changing local files.",
    pull: "Pull incoming commits (fast-forward only).",
    push: "Push outgoing commits.",
    sync: "Fetch, then pull and push when needed.",
    "switch-base-and-pull": `Switch to ${repo.baseBranch}, then pull (fast-forward only).`,
  };
  return {
    activity,
    canStop,
    pending,
    disabled: activity ? !canStop : Boolean(reason),
    label: canStop
      ? `Stop ${actionLabel(repo, operation).toLowerCase()}`
      : actionLabel(repo, operation),
    help: pending
      ? "Stopping. Waiting for the process to close."
      : activity
        ? "Stop this operation. Completed steps are not undone; remote updates may already have completed."
        : `${descriptions[operation]}${reason ? ` ${reason}` : ""}`,
  };
}
function activate(repo: GitRepoSummary, operation: GitRemoteOperation): void {
  const state = rowState(repo, operation);
  if (state.disabled) return;
  if (state.activity)
    void requestCancellation(state.activity.id).catch(() => {});
  else void actions.runRemoteOperation(repo.relativePath, operation);
}
</script>

{#snippet menuItems(repo: GitRepoSummary, context = false)}
  <div class="px-2 py-1 text-xs text-muted-foreground">
    {repoButtonLabel(repo, model.repositories, { maxLength: 14 })}
  </div>
  {@const Item = context ? ContextMenu.Item : DropdownMenu.Item}
  {@const Separator = context ? ContextMenu.Separator : DropdownMenu.Separator}
  {#snippet operationItem(operation: GitRemoteOperation)}
    {@const state = rowState(repo, operation)}
    {@const Icon = state.canStop ? Square : icons[operation]}
    <Item disabled={state.disabled} onclick={() => activate(repo, operation)}
      ><Icon aria-hidden="true" /><span>{state.label}</span></Item
    >
  {/snippet}
  {@render operationItem("sync")}
  {@render operationItem("fetch")}
  {@render operationItem("pull")}
  {@render operationItem("push")}
  <Separator />
  {@render operationItem("switch-base-and-pull")}
  <Item
    disabled={!model.capabilities.branches.enabled}
    onclick={() => void switcher?.openBranchDialog(repo.relativePath)}
    ><GitBranch aria-hidden="true" /><span>Switch branch</span></Item
  >
  <Separator />
  <Item
    disabled={!model.capabilities.stashes.enabled ||
      repositoryRemoteBusy(model.activeOperations ?? [], repo.relativePath)}
    onclick={() => void openStashes(repo)}
    ><ArchiveRestore aria-hidden="true" /><span>Stashes</span></Item
  >
{/snippet}

<!-- One Sync button per repository (fetch, pull, push). Any running remote
     operation of the repository shows here as a spinner that becomes Stop on
     hover or focus. Without a remote there is nothing to sync. -->
{#snippet failureAlert(repo: GitRepoSummary, failure: Activity)}
  {@const operation = remoteOperationOf(failure) ?? "sync"}
  {@const title = `${operation === "switch-base-and-pull" ? "Switch to base and pull" : actionLabel({ ...repo, ahead: 0, behind: 0 }, operation)} failed`}
  {@const message =
    failure.error?.message ?? failure.message ?? "Unknown error."}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tip })}
        <Popover size="sm" align="end" ariaLabel={title}>
          {#snippet triggerChild({ props })}
            <Button
              {...mergeProps(tip, props)}
              variant="ghost"
              size="icon-sm"
              class="text-destructive hover:text-destructive aria-expanded:text-destructive"
              aria-label={`${title} in ${repo.name}`}
              ><CircleAlert aria-hidden="true" /></Button
            >
          {/snippet}
          <PopoverHeader {title} />
          <PopoverBody>
            <p class="text-destructive break-words">{message}</p>
            <div class="flex gap-1">
              <Button
                size="sm"
                onclick={() =>
                  failure.actions.retry && actions.retryOperation
                    ? void actions.retryOperation(failure.id)
                    : void actions.runRemoteOperation(
                        repo.relativePath,
                        operation,
                      )}>Retry</Button
              >
              {#if actions.dismissOperation}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => void actions.dismissOperation?.(failure.id)}
                  >Dismiss</Button
                >
              {/if}
            </div>
          </PopoverBody>
        </Popover>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{title}: {message}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{#snippet rowActions(repo: GitRepoSummary)}
  {@const failure = model.lastRemoteFailure?.(repo.relativePath)}
  {#if failure}{@render failureAlert(repo, failure)}{/if}
  {#if repo.hasRemote}
    {@const running = runningRemoteActivity(
      model.activeOperations ?? [],
      repo.relativePath,
    )}
    {@const stopping = Boolean(running && cancellingIds.has(running.id))}
    {@const canStop = Boolean(
      running?.actions.cancel && actions.cancelOperation && !stopping,
    )}
    {@const sync = syncSummary(repo)}
    {@const syncState = rowState(repo, "sync")}
    {@const disabled = running ? !canStop : syncState.disabled}
    {@const help = stopping
      ? "Stopping. Waiting for the process to close."
      : running
        ? canStop
          ? "Stop this operation. Completed steps are not undone; remote updates may already have completed."
          : "Another operation is running in this repository."
        : sync.help}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size={sync.parts.length && !running ? "sm" : "icon-sm"}
            aria-label={`${running ? "Stop" : "Sync"} ${repo.name}`}
            aria-disabled={disabled}
            class={disabled
              ? "cursor-default text-muted-foreground opacity-40"
              : "text-muted-foreground hover:text-foreground"}
            onclick={() => {
              if (disabled) return;
              if (running) void requestCancellation(running.id).catch(() => {});
              else void actions.runRemoteOperation(repo.relativePath, "sync");
            }}
          >
            {#if running}
              {#if canStop}
                <Spinner
                  class="group-focus-visible/button:hidden group-hover/button:hidden"
                />
                <Square
                  class="hidden fill-current group-focus-visible/button:block group-hover/button:block"
                  aria-hidden="true"
                />
              {:else}
                <Spinner />
              {/if}
            {:else}
              <ArrowDownUp aria-hidden="true" />
              {#if sync.parts.length}
                <span class="tabular-nums">{sync.parts.join(" ")}</span>
              {/if}
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>
        <p>{help}</p>
        {#if !running && syncState.disabled}
          <p class="text-muted-foreground">{syncState.help}</p>
        {/if}
      </Tooltip.Content>
    </Tooltip.Root>
  {/if}
{/snippet}

{#snippet repositoryContextItems(repo: GitRepoSummary)}{@render menuItems(
    repo,
    true,
  )}{/snippet}

<Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
  <PanelView>
    {#snippet banner()}
      <PanelHeader title="Git changes" count={totalChangeCount}>
        {#snippet trailing()}
          {#if model.repositories.length > 1 && actions.runBulkRemoteOperation}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="All repositories"
                    title="All repositories"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <div class="px-2 py-1 text-xs text-muted-foreground">
                  All repositories
                </div>
                <DropdownMenu.Item
                  disabled={!model.capabilities.remote.fetch.enabled ||
                    bulkRepositories.length === 0}
                  onclick={() => void actions.runBulkRemoteOperation?.("fetch")}
                  ><CloudDownload aria-hidden="true" />Fetch all</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  disabled={!model.capabilities.remote.pull.enabled ||
                    bulkRepositories.length === 0}
                  onclick={() => void actions.runBulkRemoteOperation?.("pull")}
                  ><ArrowDown aria-hidden="true" />Pull all</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  disabled={!model.capabilities.remote["switch-base-and-pull"]
                    .enabled || bulkRepositories.length === 0}
                  onclick={() => (bulkMainOpen = true)}
                  ><GitCompareArrows aria-hidden="true" />Switch all to base and
                  pull</DropdownMenu.Item
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
          bind:this={switcher}
          {model}
          {actions}
          {rowActions}
          contextItems={repositoryContextItems}
          chipCount={(repo) => repo.changeCount}
          countTitle={(_, count) =>
            count === 0
              ? "No changes"
              : `${count} ${count === 1 ? "change" : "changes"}`}
        >
          {#snippet emptyCount()}
            <Check class="size-3.5" aria-hidden="true" />
          {/snippet}
        </GitRepoSwitcher>
      {/if}
    {/snippet}

    {#if model.availability.available && model.repositories.length > 0}
      {#if model.currentBranchPr}
        {@const pr = model.currentBranchPr}
        <div class="shrink-0 pb-1.5">
          <GitPullRequestRow
            {pr}
            expanded={expandedPr === pr.number}
            checkedOut
            disabled={!model.capabilities.openPullRequest.enabled}
            disabledReason={model.capabilities.openPullRequest.enabled
              ? undefined
              : model.capabilities.openPullRequest.reason}
            onOpen={() =>
              void actions.openPullRequest(model.selectedRepository, pr.number)}
            onToggleChecks={() =>
              (expandedPr = expandedPr === pr.number ? undefined : pr.number)}
          />
        </div>
      {:else if model.awaitingPullRequest}
        <div class="px-2 pb-2 text-xs text-muted-foreground">
          {#if model.expectedPullRequestUrl}<a
              class="hover:underline"
              href={model.expectedPullRequestUrl}
              target="_blank"
              rel="noreferrer">Waiting for pull request…</a
            >{:else}Waiting for pull request…{/if}
        </div>
      {/if}
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
            count: gitFilesInScope(model.changes?.files ?? [], area, path)
              .length,
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
</Tooltip.Provider>

{#key stashTarget}
  <GitStashDialog
    bind:open={stashDialogOpen}
    repositoryName={stashTarget
      ? `${stashTarget.name} (${stashTarget.absDir})`
      : ""}
    stashes={stashSnapshot}
    mutation={stashMutation}
    onApply={(stash) => void mutateStash("apply", stash)}
    onDrop={(stash) => void mutateStash("drop", stash)}
  />
{/key}

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
