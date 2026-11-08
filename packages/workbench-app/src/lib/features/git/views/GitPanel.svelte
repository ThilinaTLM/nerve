<script lang="ts">
import type { Activity } from "@nervekit/contracts/activity";
import type { GitRepoSummary, GitStashEntry } from "@nervekit/contracts/git";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
import { GithubMark } from "@nervekit/ui-kit/components/composites/github-mark";
import { SvelteSet } from "svelte/reactivity";
import { tick, type Component } from "svelte";
import Archive from "@lucide/svelte/icons/archive";
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import Cloud from "@lucide/svelte/icons/cloud";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import CloudUpload from "@lucide/svelte/icons/cloud-upload";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FolderMinus from "@lucide/svelte/icons/folder-minus";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequestCreate from "@lucide/svelte/icons/git-pull-request-create";
import Link from "@lucide/svelte/icons/link";
import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Square from "@lucide/svelte/icons/square";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { cn } from "@nervekit/ui-kit/utils";
import {
  PanelHeader,
  PanelEmpty,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panels";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { gitProjectView } from "../state/git-panel-view-state.svelte";
import GitBranchSelector from "./GitBranchSelector.svelte";
import GitChangesArea from "./GitChangesArea.svelte";
import GitPullRequestRow from "./GitPullRequestRow.svelte";
import GitRepoTree from "./GitRepoTree.svelte";
import GitSplitLayout from "./GitSplitLayout.svelte";
import GitStashDialog from "./GitStashDialog.svelte";
import GitWorktreeCreateDialog from "./GitWorktreeCreateDialog.svelte";
import GitWorktreeRemoveDialog from "./GitWorktreeRemoveDialog.svelte";
import { gitFileGroups, gitFilesInScope } from "./git-panel-controller.js";
import type {
  GitPanelActions,
  GitPanelModel,
  GitRemoteOperation,
} from "./git-panel-types.js";
import {
  activeRemoteOperation,
  primaryRemoteAction,
  remoteOperationOf,
  repositoryRemoteBusy,
  runningRemoteActivity,
} from "./git-remote-actions";
import {
  buildRepoGroups,
  checkedOutElsewhere,
  filterCounts,
  filterRepoGroups,
  isPrimaryWorktree,
  stashCountOf,
  worktreeGroupOf,
  type BranchStatusContext,
  type GitPanelFilter,
  type GitRepoGroup,
  type SyncState,
} from "./git-repo-tree";

let {
  model,
  actions,
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

const view = $derived(gitProjectView(model.projectId ?? "default"));
let split = $state<ReturnType<typeof GitSplitLayout>>();
let selector = $state<ReturnType<typeof GitBranchSelector>>();

// ---- Stashes (one list per repository) -----------------------------------------
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

// ---- Worktrees ------------------------------------------------------------------
let createOpen = $state(false);
let createGroup = $state<GitRepoGroup>();
let createInitialBranch = $state("");
let removeOpen = $state(false);
let removeTarget = $state<GitRepoSummary>();
function requestCreateWorktree(repo: GitRepoSummary, branch = ""): void {
  createGroup = groupOf(repo);
  createInitialBranch = branch;
  createOpen = true;
}
function requestRemoveWorktree(repo: GitRepoSummary): void {
  if (isPrimaryWorktree(repo)) return;
  removeTarget = repo;
  removeOpen = true;
}

// ---- Operations -------------------------------------------------------------------
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
/** "Switch all to base" targets each repository's primary checkout only. */
const bulkSwitchRepositories = $derived(
  bulkRepositories.filter(isPrimaryWorktree),
);
let discardOpen = $state(false);
type DiscardCandidate =
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
    };
let discardCandidate = $state<DiscardCandidate>();
function requestDiscard(candidate: DiscardCandidate): void {
  discardCandidate = candidate;
  discardOpen = true;
}

const fileGroups = $derived(gitFileGroups(model.changes?.files ?? []));
const totalChangeCount = $derived(
  model.repositories.reduce((sum, repo) => sum + repo.changeCount, 0),
);
let expandedPr = $state<number>();

// ---- Repositories and branches -------------------------------------------------
const groups = $derived(buildRepoGroups(model.repositories));
const groupOf = (repo: GitRepoSummary): GitRepoGroup | undefined =>
  groups.find((group) => group.key === worktreeGroupOf(repo));
const statusContext: BranchStatusContext = {
  failed: (repo) => Boolean(model.lastRemoteFailure?.(repo.relativePath)),
  running: (repo) =>
    Boolean(
      runningRemoteActivity(model.activeOperations ?? [], repo.relativePath),
    ),
  pullRequest: (repo) =>
    model.branchPullRequest?.(repo.relativePath) ??
    (repo.relativePath === model.selectedRepository
      ? model.currentBranchPr
      : undefined),
};
const counts = $derived(filterCounts(model.repositories, statusContext));
const filtered = $derived(
  filterRepoGroups(groups, {
    filter: view.filter,
    search: view.search,
    context: statusContext,
  }),
);
/** A single worktree needs neither search, filters nor a list. */
const showList = $derived(model.repositories.length > 1);
const selectedRepo = $derived(
  model.repositories.find(
    (repo) => repo.relativePath === model.selectedRepository,
  ),
);
const selectedGroup = $derived(selectedRepo && groupOf(selectedRepo));
const selectedElsewhere = $derived(
  selectedRepo
    ? checkedOutElsewhere(selectedGroup, selectedRepo)
    : new Map<string, string>(),
);

function selectBranch(repository: string): void {
  if (repository !== model.selectedRepository)
    void actions.selectRepository(repository);
}
/** Double-clicking a branch row opens the branch picker for that worktree. */
async function openBranchPicker(repository: string): Promise<void> {
  if (!model.capabilities.branches.enabled) return;
  if (repository !== model.selectedRepository)
    await actions.selectRepository(repository);
  split?.openSection("branch");
  await tick();
  selector?.openBranchPicker();
}
function openChanges(repository: string): void {
  selectBranch(repository);
  split?.openSection("changes");
}
function failureDetail(repo: GitRepoSummary): {
  operation?: string;
  failure?: string;
} {
  const failure = model.lastRemoteFailure?.(repo.relativePath);
  if (!failure) return {};
  const operation = remoteOperationOf(failure) ?? "sync";
  return {
    operation: operationName(operation),
    failure: failure.error?.message ?? failure.message,
  };
}
function operationName(operation: GitRemoteOperation): string {
  return operation === "switch-base-and-pull"
    ? "Switch to base and pull"
    : operation === "fetch"
      ? "Fetch"
      : operation === "pull"
        ? "Pull"
        : operation === "push"
          ? "Push"
          : "Sync";
}

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
  if (operation === "switch-base-and-pull") return `Back to ${repo.baseBranch}`;
  if (operation === "pull")
    return `Pull${repo.behind ? ` (${repo.behind})` : ""}`;
  if (operation === "push") {
    const count = repo.hasUpstream ? repo.ahead : repo.unpublishedCount;
    return `${repo.hasUpstream ? "Push" : "Publish branch"}${count ? ` (${count})` : ""}`;
  }
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
  // Without an upstream, Push publishes the branch, even with nothing new.
  if (
    !reason &&
    operation === "push" &&
    repo.hasUpstream &&
    !(repo.ahead && repo.ahead > 0)
  )
    reason = "No outgoing commits.";
  if (!reason && operation === "switch-base-and-pull" && repo.onBaseBranch)
    reason = `Already on ${repo.baseBranch}.`;
  if (!reason && operation === "switch-base-and-pull") {
    const folder = checkedOutElsewhere(groupOf(repo), repo).get(
      repo.baseBranch,
    );
    if (folder)
      reason = `${repo.baseBranch} is checked out in ${folder}; Git allows a branch in one worktree only.`;
  }
  const descriptions = {
    fetch: "Fetch remote updates without changing local files.",
    pull: "Pull incoming commits (fast-forward only).",
    push: repo.hasUpstream
      ? "Push outgoing commits."
      : "Publish this branch to origin under the same name.",
    sync: "Fetch, then pull and push when needed.",
    "switch-base-and-pull": `Switch to ${repo.baseBranch}, then pull (fast-forward only).`,
  };
  return {
    activity,
    canStop,
    pending,
    reason,
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
function retryFailure(repo: GitRepoSummary, failure: Activity): void {
  if (failure.actions.retry && actions.retryOperation)
    void actions.retryOperation(failure.id);
  else
    void actions.runRemoteOperation(
      repo.relativePath,
      remoteOperationOf(failure) ?? "sync",
    );
}
/** Clicking a sync glyph runs the action it announces. */
function runSyncAction(repo: GitRepoSummary, state: SyncState): void {
  const running = runningRemoteActivity(
    model.activeOperations ?? [],
    repo.relativePath,
  );
  if (state.kind === "running" && running) {
    void requestCancellation(running.id).catch(() => {});
    return;
  }
  const failure = model.lastRemoteFailure?.(repo.relativePath);
  if (state.kind === "failed" && failure) return retryFailure(repo, failure);
  const operation: GitRemoteOperation | undefined =
    state.kind === "behind"
      ? "pull"
      : state.kind === "diverged" || state.kind === "none"
        ? "sync"
        : state.kind === "ahead" || state.kind === "unpublished"
          ? "push"
          : undefined;
  if (operation) activate(repo, operation);
}

// ---- GitHub links --------------------------------------------------------------
const repositoryUrl = (repo: GitRepoSummary) =>
  model.repoBranchState(repo.relativePath).repositoryUrl;
function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
async function copyUrl(url: string): Promise<void> {
  try {
    await writeClipboardText(url);
    notify.success("Copied repository URL");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
function compareUrl(repo: GitRepoSummary): string | undefined {
  const url = repositoryUrl(repo);
  return url && repo.currentBranch
    ? `${url}/compare/${encodeURIComponent(repo.baseBranch)}...${repo.currentBranch
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?expand=1`
    : undefined;
}

const stashesDisabled = (repo: GitRepoSummary) =>
  !model.capabilities.stashes.enabled ||
  repositoryRemoteBusy(model.activeOperations ?? [], repo.relativePath);
</script>

{#snippet branchMenuItems(repo: GitRepoSummary, context: boolean)}
  {@const Item = context ? ContextMenu.Item : DropdownMenu.Item}
  {@const Separator = context ? ContextMenu.Separator : DropdownMenu.Separator}
  {@const url = repositoryUrl(repo)}
  {#snippet operationItem(operation: GitRemoteOperation)}
    {@const state = rowState(repo, operation)}
    {@const Icon = state.canStop ? Square : icons[operation]}
    <Item
      disabled={state.disabled}
      title={state.reason || undefined}
      onclick={() => activate(repo, operation)}
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
    onclick={() => {
      if (repo.relativePath !== model.selectedRepository)
        void Promise.resolve(actions.selectRepository(repo.relativePath)).then(
          () => selector?.openBranchDialog(),
        );
      else selector?.openBranchDialog();
    }}><GitBranch aria-hidden="true" /><span>Switch branch</span></Item
  >
  <Item disabled={stashesDisabled(repo)} onclick={() => void openStashes(repo)}
    ><ArchiveRestore aria-hidden="true" /><span>Stashes</span></Item
  >
  <Separator />
  <Item
    disabled={!model.capabilities.worktrees.enabled}
    onclick={() => requestCreateWorktree(repo)}
    ><FolderPlus aria-hidden="true" /><span>New worktree</span></Item
  >
  <!-- The primary worktree is the repository itself: it is never removable. -->
  {#if !isPrimaryWorktree(repo)}
    <Item
      variant="destructive"
      disabled={!model.capabilities.worktrees.enabled}
      onclick={() => requestRemoveWorktree(repo)}
      ><FolderMinus aria-hidden="true" /><span>Remove worktree</span></Item
    >
  {/if}
  {#if repo.hasGithubRemote}
    <Separator />
    <Item disabled={!url} onclick={() => url && openExternal(url)}
      ><ExternalLink aria-hidden="true" /><span>Open on GitHub</span></Item
    >
    <Item
      disabled={!compareUrl(repo) ||
        repo.onBaseBranch ||
        Boolean(statusContext.pullRequest(repo))}
      onclick={() => {
        const target = compareUrl(repo);
        if (target) openExternal(target);
      }}
      ><GitPullRequestCreate aria-hidden="true" /><span
        >Create pull request</span
      ></Item
    >
    <Item disabled={!url} onclick={() => url && void copyUrl(url)}
      ><Link aria-hidden="true" /><span>Copy repository URL</span></Item
    >
  {/if}
{/snippet}

{#snippet branchContextMenu(repo: GitRepoSummary)}
  {@render branchMenuItems(repo, true)}
{/snippet}

{#snippet repositoryMenu(group: GitRepoGroup)}
  {@const url = repositoryUrl(group.primary)}
  {@const fetch = rowState(group.primary, "fetch")}
  <ContextMenu.Item
    disabled={!model.capabilities.worktrees.enabled}
    onclick={() => requestCreateWorktree(group.primary)}
    ><FolderPlus aria-hidden="true" /><span>New worktree</span
    ></ContextMenu.Item
  >
  <ContextMenu.Separator />
  <ContextMenu.Item
    disabled={fetch.disabled}
    onclick={() => activate(group.primary, "fetch")}
    ><CloudDownload aria-hidden="true" /><span>Fetch</span></ContextMenu.Item
  >
  {#if group.primary.hasGithubRemote}
    <ContextMenu.Item disabled={!url} onclick={() => url && openExternal(url)}
      ><ExternalLink aria-hidden="true" /><span>Open on GitHub</span
      ></ContextMenu.Item
    >
    <ContextMenu.Item disabled={!url} onclick={() => url && void copyUrl(url)}
      ><Link aria-hidden="true" /><span>Copy repository URL</span
      ></ContextMenu.Item
    >
  {/if}
  <ContextMenu.Separator />
  <ContextMenu.Item
    onclick={() => view.setExpanded(group.key, !view.expanded.has(group.key))}
  >
    {#if view.expanded.has(group.key)}
      <ChevronRight aria-hidden="true" /><span>Collapse</span>
    {:else}
      <ChevronDown aria-hidden="true" /><span>Expand</span>
    {/if}
  </ContextMenu.Item>
{/snippet}

{#snippet remoteIcon(repo: GitRepoSummary)}
  {#if !repo.hasRemote}
    <CloudOff
      class="size-3.5 shrink-0 text-muted-foreground"
      aria-label="No remote"
    />
  {:else if repo.hasGithubRemote}
    <GithubMark class="size-3.5 shrink-0 text-primary" />
  {:else}
    <Cloud
      class="size-3.5 shrink-0 text-primary"
      aria-label="Remote (not GitHub)"
    />
  {/if}
{/snippet}

<!-- Icon-only header action. Disabled actions explain themselves in the tooltip. -->
{#snippet actionIcon(
  Icon: Component<{ class?: string }>,
  label: string,
  options: { tone?: string; disabled?: boolean; onclick: () => void },
)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-disabled={options.disabled}
          class={cn(
            options.disabled
              ? "cursor-default opacity-40"
              : "hover:text-foreground",
            options.tone ?? "text-muted-foreground",
          )}
          onclick={() => {
            if (!options.disabled) options.onclick();
          }}><Icon /></Button
        >
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{label}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<!-- The one remote action the branch state calls for, then the merged
     shortcut. Stop replaces the action while something runs. -->
{#snippet branchActions(repo: GitRepoSummary)}
  {@const running = runningRemoteActivity(
    model.activeOperations ?? [],
    repo.relativePath,
  )}
  {@const failure = model.lastRemoteFailure?.(repo.relativePath)}
  {@const primary = primaryRemoteAction(repo)}
  {@const op = primary.operation}
  {@const opState = rowState(repo, op)}
  {#if repo.hasRemote}
    {#if running}
      {@const stopping = cancellingIds.has(running.id)}
      {@const canStop = Boolean(
        running.actions.cancel && actions.cancelOperation && !stopping,
      )}
      {@render actionIcon(
        Square,
        stopping
          ? "Stopping. Waiting for the process to close."
          : canStop
            ? `Stop ${operationName(remoteOperationOf(running) ?? "sync").toLowerCase()}`
            : "Another operation is running in this repository.",
        {
          disabled: !canStop,
          onclick: () => void requestCancellation(running.id).catch(() => {}),
        },
      )}
    {:else if failure}
      {@render actionIcon(
        CircleAlert,
        `${operationName(remoteOperationOf(failure) ?? "sync")} failed: ${failure.error?.message ?? failure.message ?? "Unknown error"}. Retry`,
        {
          tone: "text-destructive",
          onclick: () => retryFailure(repo, failure),
        },
      )}
    {:else}
      {@render actionIcon(
        primary.label === "Publish branch"
          ? CloudUpload
          : icons[op === "sync" ? "sync" : op],
        `${primary.help}${opState.reason ? `. ${opState.reason}` : ""}`,
        {
          tone:
            op === "pull" || (op === "sync" && primary.parts.length)
              ? "text-warning"
              : undefined,
          disabled: opState.disabled,
          onclick: () => activate(repo, op),
        },
      )}
    {/if}
    {#if repo.mergedToBase && !repo.onBaseBranch}
      {@const merged = rowState(repo, "switch-base-and-pull")}
      {@render actionIcon(
        GitMerge,
        `Merged into ${repo.baseBranch}. Switch to ${repo.baseBranch} and pull${merged.reason ? `. ${merged.reason}` : ""}`,
        {
          tone: "text-info",
          disabled: merged.disabled,
          onclick: () => activate(repo, "switch-base-and-pull"),
        },
      )}
    {/if}
  {/if}
{/snippet}

<!-- Section header: a button that collapses the section; the line stays
     visible as the collapsed state. -->
{#snippet sectionToggle(
  open: boolean,
  toggle: () => void,
  label: import("svelte").Snippet,
)}
  <button
    type="button"
    class="group/section flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-focus"
    aria-expanded={open}
    onclick={toggle}
  >
    {#if open}
      <ChevronDown
        class="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/section:text-foreground"
      />
    {:else}
      <ChevronRight
        class="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/section:text-foreground"
      />
    {/if}
    {@render label()}
  </button>
{/snippet}

{#snippet branchSection(
  open: boolean,
  toggle: () => void,
  measure: import("svelte/attachments").Attachment<HTMLElement>,
  overflows: boolean,
)}
  {@const repo = selectedRepo}
  <div class="flex h-full min-h-0 flex-col text-ui">
    <div class="flex h-8 shrink-0 items-center gap-1">
      {#snippet label()}
        {#if repo}
          {@render remoteIcon(repo)}
          <!-- The name keeps priority (up to half the line) over the branch. -->
          <span
            class="max-w-1/2 shrink-0 truncate font-medium"
            title={repo.absDir}>{repo.name}</span
          >
          <!-- Expanded, the selector below shows the branch. -->
          {#if !open}
            <span
              class="min-w-0 shrink truncate text-muted-foreground"
              title={repo.currentBranch ?? "detached"}
              >{repo.currentBranch ?? "detached"}</span
            >
          {/if}
        {:else}
          <span class="font-medium">Selected branch</span>
        {/if}
      {/snippet}
      {@render sectionToggle(open, toggle, label)}
      {#if repo}
        <span class="flex shrink-0 items-center gap-0.5"
          >{@render branchActions(repo)}</span
        >
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                aria-label="Branch actions"
                ><MoreHorizontal aria-hidden="true" /></Button
              >
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end"
            >{@render branchMenuItems(repo, false)}</DropdownMenu.Content
          >
        </DropdownMenu.Root>
      {/if}
    </div>
    <div
      class={cn(
        "min-h-0 flex-1",
        overflows ? "overflow-y-auto" : "overflow-hidden",
      )}
      inert={!open}
    >
      <!-- Natural content height: the layout fits the section to it. -->
      <div class="flex flex-col gap-1.5 pb-2" {@attach measure}>
        {#if repo}
          <GitBranchSelector
            bind:this={selector}
            {model}
            {actions}
            {repo}
            checkedOutIn={selectedElsewhere}
          />
          {@const failure = model.lastRemoteFailure?.(repo.relativePath)}
          {#if failure}
            <p class="text-caption break-words text-destructive">
              {failure.error?.message ?? failure.message ?? "Operation failed."}
            </p>
          {/if}
          {#if model.currentBranchPr}
            {@const pr = model.currentBranchPr}
            <GitPullRequestRow
              {pr}
              expanded={expandedPr === pr.number}
              checkedOut
              disabled={!model.capabilities.openPullRequest.enabled}
              disabledReason={model.capabilities.openPullRequest.enabled
                ? undefined
                : model.capabilities.openPullRequest.reason}
              onOpen={() =>
                void actions.openPullRequest(
                  model.selectedRepository,
                  pr.number,
                )}
              onToggleChecks={() =>
                (expandedPr = expandedPr === pr.number ? undefined : pr.number)}
            />
          {:else if model.awaitingPullRequest}
            <p class="text-ui text-muted-foreground">
              {#if model.expectedPullRequestUrl}<a
                  class="hover:text-foreground"
                  href={model.expectedPullRequestUrl}
                  target="_blank"
                  rel="noreferrer">Waiting for pull request…</a
                >{:else}Waiting for pull request…{/if}
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet changesSection(open: boolean, toggle: () => void)}
  {@const count = model.changes?.files.length ?? selectedRepo?.changeCount ?? 0}
  {@const staged = model.changes?.stagedCount ?? 0}
  <div class="flex h-full min-h-0 flex-col text-ui">
    <div class="flex h-8 shrink-0 items-center gap-1.5">
      {#snippet label()}
        <span class="font-medium">Changes</span>
        <span class="text-muted-foreground tabular-nums">{count || "none"}</span
        >
        <span class="flex-1"></span>
        {#if staged > 0}
          <span class="pr-1 text-caption text-muted-foreground"
            >{staged} staged</span
          >
        {/if}
      {/snippet}
      {@render sectionToggle(open, toggle, label)}
      <!-- Stashes sit with the changes they came from and are shared by every
           worktree of the repository. -->
      {#if selectedRepo && stashCountOf(selectedRepo) > 0}
        {@const repo = selectedRepo}
        {@const stashCount = stashCountOf(repo)}
        {@const noun = stashCount === 1 ? "stash" : "stashes"}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="sm"
                class="gap-1 px-1.5 text-muted-foreground tabular-nums hover:text-foreground"
                disabled={stashesDisabled(repo)}
                aria-label={`${stashCount} ${noun} in ${repo.name} (shared by all worktrees). Open stashes`}
                onclick={() => void openStashes(repo)}
                ><Archive aria-hidden="true" />{stashCount}</Button
              >
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content
            >{stashCount}
            {noun} in {repo.name} (shared by all worktrees). Open stashes</Tooltip.Content
          >
        </Tooltip.Root>
      {/if}
    </div>
    <div
      class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2"
      inert={!open}
    >
      {#if count > 0 || (model.changes?.files.length ?? 0) > 0}
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
            requestDiscard({
              kind: "file",
              repository: model.selectedRepository,
              file,
            })}
          onRequestDiscardScope={(area, path) =>
            requestDiscard({
              kind: "scope",
              repository: model.selectedRepository,
              area,
              ...(path ? { path } : {}),
              count: gitFilesInScope(model.changes?.files ?? [], area, path)
                .length,
            })}
        />
      {:else}
        <p class="py-1 text-ui text-muted-foreground">Working tree clean.</p>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet repositoryList({
  measure,
  overflows,
}: {
  measure: import("svelte/attachments").Attachment<HTMLElement>;
  overflows: boolean;
})}
  <div
    class={cn(
      "-mx-2 h-full min-h-0 px-2",
      overflows ? "overflow-y-auto" : "overflow-hidden",
    )}
  >
    <div class="py-1.5" {@attach measure}>
      <GitRepoTree
        groups={filtered}
        forceExpanded={view.search.trim() !== "" || view.filter !== "all"}
        expanded={view.expanded}
        selected={model.selectedRepository}
        selectable={model.capabilities.selectRepository.enabled}
        context={statusContext}
        {failureDetail}
        {repositoryMenu}
        branchMenu={branchContextMenu}
        onToggleGroup={(key, open) => view.setExpanded(key, open)}
        onSelect={selectBranch}
        onOpenChanges={openChanges}
        onOpenBranchPicker={(repository) => void openBranchPicker(repository)}
        onSyncAction={runSyncAction}
        onFetch={(repo) => activate(repo, "fetch")}
        onOpenPullRequest={(repo, pr) =>
          void actions.openPullRequest(repo.relativePath, pr.number)}
        onHint={actions.hintRepository}
      />
    </div>
  </div>
{/snippet}

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
                <div class="px-2 py-1 text-ui text-muted-foreground">
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
                    .enabled || bulkSwitchRepositories.length === 0}
                  onclick={() => (bulkMainOpen = true)}
                  title="Switch each repository's primary checkout to its base branch and pull"
                  ><GitCompareArrows aria-hidden="true" />Back to base</DropdownMenu.Item
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

      {#if model.availability.available && model.repositories.length > 0 && showList}
        <div class="flex flex-col gap-1.5 pt-1 pb-1.5">
          <SearchInput
            bind:value={view.search}
            placeholder="Filter repos or branches"
            ariaLabel="Filter repositories and branches"
          />
          <ToggleGroup.Root
            type="single"
            variant="chip"
            size="sm"
            value={view.filter}
            aria-label="Show"
            onValueChange={(value) => {
              if (value) view.setFilter(value as GitPanelFilter);
            }}
          >
            <ToggleGroup.Item value="all">All {counts.all}</ToggleGroup.Item>
            <ToggleGroup.Item
              value="changed"
              title="Branches with uncommitted changes"
              >Changed {counts.changed}</ToggleGroup.Item
            >
            <ToggleGroup.Item
              value="attention"
              title="Failed operations, failing checks, merged branches, or behind with local work"
              >Attention {counts.attention}</ToggleGroup.Item
            >
          </ToggleGroup.Root>
        </div>
      {/if}
    {/snippet}

    {#if model.availability.available && model.repositories.length > 0}
      <GitSplitLayout
        bind:this={split}
        list={showList ? repositoryList : undefined}
      >
        {#snippet branch({ open, toggle, measure, overflows })}
          {@render branchSection(open, toggle, measure, overflows)}
        {/snippet}
        {#snippet changes({ open, toggle })}
          {@render changesSection(open, toggle)}
        {/snippet}
      </GitSplitLayout>
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
    repositoryName={stashTarget?.name ?? ""}
    stashes={stashSnapshot}
    mutation={stashMutation}
    onApply={(stash) => void mutateStash("apply", stash)}
    onDrop={(stash) => void mutateStash("drop", stash)}
  />
{/key}

<ConfirmDialog
  bind:open={discardOpen}
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
/>

<ConfirmDialog
  bind:open={bulkMainOpen}
  title="Switch base branches and pull all?"
  description={`Switch each repository's primary checkout to its base branch and pull with fast-forward only: ${bulkSwitchRepositories.map((repo) => `${repo.name} (${repo.baseBranch})`).join(", ")}. Local changes are kept; Git stops if files would be overwritten. Each repository reports its result independently in Activity.`}
  confirmLabel="Switch and pull all"
  onConfirm={() =>
    void actions.runBulkRemoteOperation?.("switch-base-and-pull")}
/>

<GitWorktreeCreateDialog
  bind:open={createOpen}
  group={createGroup}
  multiRepo={groups.length > 1}
  initialBranch={createInitialBranch}
  busy={model.operations.creatingWorktree}
  onSubmit={(branch, id) =>
    actions.createWorktree(
      createGroup?.primary.relativePath ?? model.selectedRepository,
      branch,
      id,
    )}
/>

<GitWorktreeRemoveDialog
  bind:open={removeOpen}
  target={removeTarget}
  busy={model.operations.removingWorktree}
  onSubmit={(options) =>
    removeTarget
      ? actions.removeWorktree(removeTarget.relativePath, options)
      : false}
/>
