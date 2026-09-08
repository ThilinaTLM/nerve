<script lang="ts">
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import type {
  GitBranchDialogGroups,
  GitBranchDialogRow,
} from "./git-panel-controller";
import type { GitPanelCapabilities } from "./git-panel-types";
import GitBranchDialog from "./GitBranchDialog.svelte";
import GitRepositorySelector from "./GitRepositorySelector.svelte";

type Props = {
  repoSummary?: GitRepoSummary;
  repos: GitRepoSummary[];
  selectedRepo: string;
  branchGroups: GitBranchDialogGroups;
  branchRowsFor: (repository: string) => readonly GitBranchDialogRow[];
  loadingBranchesFor: (repository: string) => boolean;
  switchingBranchFor: (repository: string) => string | undefined;
  loadingBranches: boolean;
  loadingPrHeads: boolean;
  switchingBranch?: string;
  deletingBranch?: string;
  creatingBranch: boolean;
  capabilities: GitPanelCapabilities;
  branchFilter?: string;
  newBranchName?: string;
  branchDialogOpen?: boolean;
  branchDialogView?: "switch" | "create";
  onSelectRepo: (value: string) => void;
  onLoadBranches: (repository: string) => void;
  onManageBranches: (repository: string) => void;
  onCreateBranchFlow: (repository: string) => void;
  onSwitchBranch: (repo: string, branch: GitBranchSummary) => void;
  onDeleteBranch: (
    repo: string,
    branch: GitBranchSummary,
  ) => boolean | Promise<boolean>;
  onOpenPullRequest: (repo: string, number: number) => void;
  onRefreshBranches: (repository: string) => void;
  onCreateBranch: (repo: string) => void;
};

let {
  repoSummary,
  repos,
  selectedRepo,
  branchGroups,
  branchRowsFor,
  loadingBranchesFor,
  switchingBranchFor,
  loadingBranches,
  loadingPrHeads,
  switchingBranch,
  deletingBranch,
  creatingBranch,
  capabilities,
  branchFilter = $bindable(""),
  newBranchName = $bindable(""),
  branchDialogOpen = $bindable(false),
  branchDialogView = $bindable("switch"),
  onSelectRepo,
  onLoadBranches,
  onManageBranches,
  onCreateBranchFlow,
  onSwitchBranch,
  onDeleteBranch,
  onOpenPullRequest,
  onRefreshBranches,
  onCreateBranch,
}: Props = $props();
</script>

<div class="flex shrink-0 flex-col gap-1.5 pt-1.5">
  <GitRepositorySelector
    {repos}
    {selectedRepo}
    selectCapability={capabilities.selectRepository}
    {onSelectRepo}
    branches={{
      capability: capabilities.branches,
      rowsFor: branchRowsFor,
      loadingFor: loadingBranchesFor,
      switchingFor: switchingBranchFor,
      onLoad: onLoadBranches,
      onSwitch: onSwitchBranch,
      onManage: onManageBranches,
      onCreate: onCreateBranchFlow,
    }}
  />

  {#if repoSummary}
    {@const repo = repoSummary}
    {#if !repo.hasRemote}
      <p class="text-xs text-muted-foreground">
        Remote actions are unavailable for local-only repositories.
      </p>
    {/if}

    <GitBranchDialog
      bind:open={branchDialogOpen}
      repoSummary={repo}
      {selectedRepo}
      {branchGroups}
      {loadingBranches}
      {loadingPrHeads}
      {switchingBranch}
      {deletingBranch}
      {creatingBranch}
      branchesEnabled={capabilities.branches.enabled}
      bind:branchFilter
      bind:newBranchName
      bind:view={branchDialogView}
      {onSwitchBranch}
      {onDeleteBranch}
      {onOpenPullRequest}
      onRefreshBranches={() => onRefreshBranches(selectedRepo)}
      {onCreateBranch}
    />
  {/if}
</div>
