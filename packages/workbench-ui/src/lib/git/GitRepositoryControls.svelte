<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts";
import { cn } from "@nervekit/ui-kit/core/utils";
import type { GitPanelCapabilities } from "./git-panel-types";
import GitBranchDialog from "./GitBranchDialog.svelte";
import GitRepositorySelector from "./GitRepositorySelector.svelte";

type Props = {
  repoSummary?: GitRepoSummary;
  repos: GitRepoSummary[];
  selectedRepo: string;
  filteredBranches: GitBranchSummary[];
  loadingBranches: boolean;
  switchingBranch?: string;
  creatingBranch: boolean;
  capabilities: GitPanelCapabilities;
  branchFilter?: string;
  newBranchName?: string;
  branchDialogOpen?: boolean;
  baseBranchSummary?: GitBranchSummary;
  onSelectRepo: (value: string) => void;
  onOpenBranchDialog: () => void;
  onSwitchBranch: (repo: string, branch: GitBranchSummary) => void;
  onCreateBranch: (repo: string) => void;
};

let {
  repoSummary,
  repos,
  selectedRepo,
  filteredBranches,
  loadingBranches,
  switchingBranch,
  creatingBranch,
  capabilities,
  branchFilter = $bindable(""),
  newBranchName = $bindable(""),
  branchDialogOpen = $bindable(false),
  baseBranchSummary,
  onSelectRepo,
  onOpenBranchDialog,
  onSwitchBranch,
  onCreateBranch,
}: Props = $props();
</script>

<div class="flex shrink-0 flex-col gap-1.5 px-1.5 pt-1.5">
  {#if repoSummary}
    {@const repo = repoSummary}
    <GitRepositorySelector
      {repos}
      {selectedRepo}
      selectCapability={capabilities.selectRepository}
      {onSelectRepo}
    />

    <button
      type="button"
      disabled={!capabilities.branches.enabled}
      title={capabilities.branches.enabled
        ? "Switch or create a branch"
        : capabilities.branches.reason}
      class={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 self-start rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        repo.detached && "text-muted-foreground",
      )}
      onclick={onOpenBranchDialog}
    >
      <GitBranch class="size-3 shrink-0" aria-hidden="true" />
      <span class="truncate font-mono"
        >{repo.currentBranch ?? "(detached)"}</span
      >
      <ChevronDown
        class="size-3 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>

    {#if !repo.hasRemote}
      <p class="text-xs text-muted-foreground">
        Remote actions are unavailable for local-only repositories.
      </p>
    {/if}

    <GitBranchDialog
      bind:open={branchDialogOpen}
      repoSummary={repo}
      {selectedRepo}
      {filteredBranches}
      {baseBranchSummary}
      {loadingBranches}
      {switchingBranch}
      {creatingBranch}
      branchesEnabled={capabilities.branches.enabled}
      bind:branchFilter
      bind:newBranchName
      {onSwitchBranch}
      {onCreateBranch}
    />
  {:else}
    <p class="text-xs text-muted-foreground">Loading…</p>
  {/if}
</div>
