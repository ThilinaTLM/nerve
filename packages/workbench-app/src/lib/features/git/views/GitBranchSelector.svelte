<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import { SvelteSet } from "svelte/reactivity";
import GitBranchDialog from "./GitBranchDialog.svelte";
import GitBranchPopover from "./GitBranchPopover.svelte";
import { repoPathLabel } from "./git-change-format";
import {
  groupBranchesForDialog,
  shouldLoadRepoBranches,
} from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";
import { splitBranchName } from "./git-repo-tree";

type Props = {
  model: GitPanelModel;
  actions: GitPanelActions;
  /** The selected worktree. */
  repo: GitRepoSummary;
  /** Local branches checked out in other worktrees of this repository. */
  checkedOutIn: ReadonlyMap<string, string>;
};

let { model, actions, repo, checkedOutIn }: Props = $props();

const repository = $derived(repo.relativePath);
let popoverOpen = $state(false);
let dialogOpen = $state(false);
let dialogView = $state<"switch" | "create">("switch");
let dialogFilter = $state("");
let newBranchName = $state("");
/** Repositories whose branch list has already been requested this session. */
const branchesRequested = new SvelteSet<string>();

const branchState = $derived(model.repoBranchState(repository));
const rows = $derived(
  groupBranchesForDialog(
    branchState.branches,
    "",
    repo.baseBranch,
    branchState.prHeads,
  ).all,
);
const dialogGroups = $derived(
  groupBranchesForDialog(
    model.branches,
    dialogFilter,
    repo.baseBranch,
    model.prHeads,
  ),
);
const parts = $derived(
  repo.currentBranch ? splitBranchName(repo.currentBranch) : undefined,
);

function refresh(): void {
  void Promise.all([
    actions.refreshBranches(repository),
    actions.loadPullRequestBadges(repository),
  ]);
}

/** Branch lists are per repository, so the picker loads its own on first open. */
function loadBranches(): void {
  if (
    !shouldLoadRepoBranches(
      branchesRequested,
      repository,
      branchState.branches.length,
    )
  )
    return;
  branchesRequested.add(repository);
  refresh();
}

function openManager(view: "switch" | "create"): void {
  dialogView = view;
  dialogFilter = "";
  newBranchName = "";
  dialogOpen = true;
  refresh();
}

/** Opens the branch picker popover (double-click on a branch row). */
export function openBranchPicker(): void {
  if (!model.capabilities.branches.enabled) return;
  popoverOpen = true;
  loadBranches();
}

/** Opens the full branch dialog for the selected worktree (context menu). */
export function openBranchDialog(): void {
  openManager("switch");
}

async function switchBranch(
  target: string,
  branch: GitBranchSummary,
): Promise<void> {
  if ((await actions.switchBranch(target, branch)) === false) return;
  dialogOpen = false;
  dialogFilter = "";
  newBranchName = "";
}

async function createBranch(target: string): Promise<void> {
  const name = newBranchName.trim();
  if (!name) return;
  if ((await actions.createBranch(target, name)) === false) return;
  dialogOpen = false;
  dialogFilter = "";
  newBranchName = "";
}
</script>

<GitBranchPopover
  {repo}
  {rows}
  {checkedOutIn}
  bind:open={popoverOpen}
  loading={branchState.loadingBranches}
  enabled={model.capabilities.branches.enabled}
  switchingBranch={branchState.switchingBranch}
  triggerClass="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-0.5 text-ui hover:bg-hover focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
  triggerTitle={`${repo.currentBranch ?? "detached"}: switch branch in ${repoPathLabel(repo)}`}
  onOpen={loadBranches}
  onSwitch={(branch) => void switchBranch(repository, branch)}
  onManage={() => openManager("switch")}
  onCreate={() => openManager("create")}
>
  {#snippet triggerContent()}
    <GitBranch
      class="size-3.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    {#if parts}
      <!-- Trimmed in the middle only: the start may shrink, the end stays. -->
      <span class="flex min-w-0 flex-1 font-mono">
        <span class="min-w-[4ch] truncate">{parts.head}</span><span
          class="shrink-0">{parts.tail}</span
        >
      </span>
    {:else}
      <span class="min-w-0 flex-1 truncate font-mono text-warning"
        >detached</span
      >
    {/if}
    <ChevronDown
      class="size-3 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  {/snippet}
</GitBranchPopover>

<GitBranchDialog
  bind:open={dialogOpen}
  repoSummary={repo}
  selectedRepo={repository}
  branchGroups={dialogGroups}
  loadingBranches={model.loadingBranches}
  loadingPrHeads={model.loadingPrHeads}
  switchingBranch={model.operations.switchingBranch}
  deletingBranch={model.operations.deletingBranch}
  creatingBranch={model.operations.creatingBranch}
  branchesEnabled={model.capabilities.branches.enabled}
  {checkedOutIn}
  bind:branchFilter={dialogFilter}
  bind:newBranchName
  bind:view={dialogView}
  onSwitchBranch={(target, branch) => void switchBranch(target, branch)}
  onDeleteBranch={async (target, branch) =>
    (await actions.deleteBranch(target, branch)) !== false}
  onOpenPullRequest={(target, number) =>
    void actions.openPullRequest(target, number)}
  onRefreshBranches={refresh}
  onCreateBranch={(target) => void createBranch(target)}
/>
