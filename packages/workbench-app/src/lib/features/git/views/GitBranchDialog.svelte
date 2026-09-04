<script lang="ts">
import Cloud from "@lucide/svelte/icons/cloud";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import GitBranchRow from "./GitBranchRow.svelte";
import type { GitBranchDialogGroups } from "./git-panel-controller";

type Props = {
  open?: boolean;
  repoSummary: GitRepoSummary;
  selectedRepo: string;
  branchGroups: GitBranchDialogGroups;
  loadingBranches: boolean;
  loadingPrHeads: boolean;
  switchingBranch?: string;
  deletingBranch?: string;
  creatingBranch: boolean;
  branchesEnabled: boolean;
  branchFilter?: string;
  newBranchName?: string;
  onSwitchBranch: (repo: string, branch: GitBranchSummary) => void;
  onDeleteBranch: (
    repo: string,
    branch: GitBranchSummary,
  ) => boolean | Promise<boolean>;
  onOpenPullRequest: (repo: string, number: number) => void;
  onRefreshBranches: () => void;
  onCreateBranch: (repo: string) => void;
};

let {
  open = $bindable(false),
  repoSummary,
  selectedRepo,
  branchGroups,
  loadingBranches,
  loadingPrHeads,
  switchingBranch,
  deletingBranch,
  creatingBranch,
  branchesEnabled,
  branchFilter = $bindable(""),
  newBranchName = $bindable(""),
  onSwitchBranch,
  onDeleteBranch,
  onOpenPullRequest,
  onRefreshBranches,
  onCreateBranch,
}: Props = $props();

let view = $state<"switch" | "create">("switch");
let showRemoteBranches = $state(false);
let deleteCandidate = $state<GitBranchSummary>();
let searchInput = $state<HTMLInputElement | null>(null);

const currentBranchLabel = $derived(repoSummary.currentBranch ?? "detached");
const visibleBranches = $derived(
  showRemoteBranches
    ? branchGroups.all
    : branchGroups.all.filter(({ branch }) => !branch.remote),
);
const resultCount = $derived(visibleBranches.length);

// A light client-side guard so the Create button stays disabled for obviously
// invalid names; git check-ref-format performs the authoritative validation.
const trimmedName = $derived(newBranchName.trim());
const isValidName = $derived(
  trimmedName.length > 0 &&
    !/\s/.test(trimmedName) &&
    !trimmedName.startsWith("-") &&
    !trimmedName.startsWith("/") &&
    !trimmedName.endsWith("/") &&
    !trimmedName.includes("..") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f~^:?*[\\]/.test(trimmedName),
);
const showNameError = $derived(trimmedName.length > 0 && !isValidName);
const dialogTitle = $derived(
  view === "switch" ? "Switch branch" : "Create branch",
);
const dialogDescription = $derived(
  view === "switch"
    ? `Current branch: ${currentBranchLabel}`
    : `Create from: ${currentBranchLabel}`,
);

$effect(() => {
  if (!open || view !== "switch") return;
  queueMicrotask(() => searchInput?.focus());
});

async function confirmDelete(): Promise<void> {
  const branch = deleteCandidate;
  deleteCandidate = undefined;
  if (branch) await onDeleteBranch(selectedRepo, branch);
}

function openPullRequest(number: number): void {
  open = false;
  onOpenPullRequest(selectedRepo, number);
}
</script>

<Dialog
  bind:open
  title={dialogTitle}
  description={dialogDescription}
  size="md"
  onOpenChange={(next) => {
    if (!next) {
      view = "switch";
      deleteCandidate = undefined;
    }
  }}
>
  {#if view === "switch"}
    <div class="grid gap-3">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={loadingBranches}
          ariaLabel="Refresh branches"
          title="Refresh branches"
          onclick={onRefreshBranches}
        >
          {#if loadingBranches}
            <Spinner class="size-3.5" />
          {:else}
            <RefreshCw class="size-3.5" aria-hidden="true" />
          {/if}
        </Button>
        <Button
          variant={showRemoteBranches ? "default" : "outline"}
          size="icon-sm"
          pressed={showRemoteBranches}
          ariaLabel={showRemoteBranches
            ? "Hide remote branches"
            : "Show remote branches"}
          title={showRemoteBranches
            ? "Hide remote branches"
            : "Show remote branches"}
          onclick={() => (showRemoteBranches = !showRemoteBranches)}
        >
          <Cloud class="size-3.5" aria-hidden="true" />
        </Button>
        <SearchInput
          bind:ref={searchInput}
          bind:value={branchFilter}
          placeholder="Search branches or PRs"
          ariaLabel="Search branches or pull requests"
          size="sm"
          class="min-w-48 flex-1"
        />
        {#if loadingPrHeads && !loadingBranches}
          <span
            class="flex size-8 items-center justify-center"
            title="Loading pull request links"
          >
            <Spinner class="size-3.5 text-muted-foreground" />
          </span>
        {/if}
      </div>

      <div class="max-h-[60vh] overflow-y-auto rounded-md border">
        {#if loadingBranches && resultCount === 0}
          <div
            class="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground"
          >
            <Spinner class="size-4" /> Loading branches…
          </div>
        {:else if resultCount === 0}
          <div class="px-3 py-10 text-center text-sm text-muted-foreground">
            {branchFilter.trim()
              ? `No branches match “${branchFilter.trim()}”.`
              : "No branches found."}
          </div>
        {:else}
          {#each visibleBranches as row (row.branch.name)}
            <GitBranchRow
              {row}
              baseBranch={repoSummary.baseBranch}
              enabled={branchesEnabled}
              switching={switchingBranch === row.branch.name}
              deleting={deletingBranch === row.branch.name}
              onSwitch={(branch) => onSwitchBranch(selectedRepo, branch)}
              onDelete={(branch) => (deleteCandidate = branch)}
              onOpenPullRequest={openPullRequest}
            />
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <form
      class="grid gap-1.5"
      onsubmit={(event) => {
        event.preventDefault();
        if (isValidName && !creatingBranch) onCreateBranch(selectedRepo);
      }}
    >
      <Input
        bind:value={newBranchName}
        placeholder="feature/branch-name"
        autofocus
        class="h-9 font-mono text-sm"
        aria-label="New branch name"
        aria-invalid={showNameError}
      />
      {#if showNameError}
        <p class="text-xs text-destructive">
          Enter a valid branch name (no spaces or special characters).
        </p>
      {:else}
        <p class="text-xs text-muted-foreground">
          The new branch is created from the current branch.
        </p>
      {/if}
    </form>
  {/if}

  {#snippet footer()}
    {#if view === "switch"}
      <span class="mr-auto text-xs text-muted-foreground tabular-nums">
        {resultCount}
        {resultCount === 1 ? "result" : "results"}
      </span>
      <Button
        size="sm"
        disabled={!branchesEnabled}
        onclick={() => (view = "create")}
      >
        <GitBranchPlus /> New branch
      </Button>
    {:else}
      <Button size="sm" variant="ghost" onclick={() => (view = "switch")}
        >Back</Button
      >
      <Button
        size="sm"
        disabled={!branchesEnabled || creatingBranch || !isValidName}
        onclick={() => onCreateBranch(selectedRepo)}
      >
        {#if creatingBranch}
          <Spinner />
        {:else}
          <GitBranch />
        {/if}
        Create
      </Button>
    {/if}
  {/snippet}
</Dialog>

<ConfirmDialog
  open={deleteCandidate !== undefined}
  title="Delete local branch?"
  description={deleteCandidate
    ? `Delete “${deleteCandidate.name}”? Git will only delete it if it is fully merged.`
    : undefined}
  confirmLabel="Delete branch"
  destructive
  onOpenChange={(next) => {
    if (!next) deleteCandidate = undefined;
  }}
  onConfirm={() => void confirmDelete()}
/>
