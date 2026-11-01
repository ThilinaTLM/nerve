<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import GitBranch from "@lucide/svelte/icons/git-branch";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import GitBranchRow from "./GitBranchRow.svelte";
import {
  isPlausibleBranchName,
  type GitBranchDialogGroups,
} from "./git-panel-controller";

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
  /** Lets callers open the dialog straight into branch creation. */
  view?: "switch" | "create";
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
  view = $bindable("switch"),
  onSwitchBranch,
  onDeleteBranch,
  onOpenPullRequest,
  onRefreshBranches,
  onCreateBranch,
}: Props = $props();

type BranchScope = "local" | "remote" | "all";

let scope = $state<BranchScope>("local");
let deleteCandidate = $state<GitBranchSummary>();
let searchInput = $state<HTMLInputElement | null>(null);

const currentBranchLabel = $derived(repoSummary.currentBranch ?? "detached");
const visibleBranches = $derived(
  scope === "all" ? branchGroups.all : branchGroups[scope],
);
const shownGroups = $derived(
  [
    {
      label: "Current",
      rows: visibleBranches.filter(({ branch }) => branch.current),
    },
    {
      label: "Local",
      rows: visibleBranches.filter(
        ({ branch }) => !branch.current && !branch.remote,
      ),
    },
    {
      label: "Remote",
      rows: visibleBranches.filter(({ branch }) => branch.remote),
    },
  ].filter((group) => group.rows.length > 0),
);
const resultCount = $derived(visibleBranches.length);

const trimmedName = $derived(newBranchName.trim());
const isValidName = $derived(isPlausibleBranchName(newBranchName));
const showNameError = $derived(trimmedName.length > 0 && !isValidName);
const dialogTitle = $derived(view === "switch" ? "Branches" : "New branch");
const dialogDescription = $derived(
  `${repoSummary.name} · on ${currentBranchLabel}`,
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
  flush
  onOpenChange={(next) => {
    if (!next) {
      view = "switch";
      deleteCandidate = undefined;
    }
  }}
>
  {#snippet headerActions()}
    {#if view === "switch"}
      <IconAction
        icon={RefreshCw}
        label="Refresh branches"
        busy={loadingBranches}
        onclick={onRefreshBranches}
      />
    {/if}
  {/snippet}

  {#if view === "switch"}
    <div class="grid gap-2 p-3">
      <div class="flex min-w-0 items-center gap-2">
        <SearchInput
          bind:ref={searchInput}
          bind:value={branchFilter}
          placeholder="Search branches or PRs"
          ariaLabel="Search branches or pull requests"
          class="min-w-0 flex-1"
        />
        {#if loadingPrHeads && !loadingBranches}
          <span title="Loading pull request links">
            <Spinner class="size-3.5 text-muted-foreground" />
          </span>
        {/if}
        <ToggleGroup.Root
          type="single"
          value={scope}
          aria-label="Branch scope"
          onValueChange={(next) => next && (scope = next as BranchScope)}
        >
          <ToggleGroup.Item value="local"
            >Local <span data-slot="toggle-count"
              >{branchGroups.local.length}</span
            ></ToggleGroup.Item
          >
          <ToggleGroup.Item value="remote"
            >Remote <span data-slot="toggle-count"
              >{branchGroups.remote.length}</span
            ></ToggleGroup.Item
          >
          <ToggleGroup.Item value="all"
            >All <span data-slot="toggle-count">{branchGroups.all.length}</span
            ></ToggleGroup.Item
          >
        </ToggleGroup.Root>
      </div>

      <div
        class="max-h-[min(60vh,28rem)] min-h-48 overflow-y-auto rounded-md bg-well p-1.5"
        role="list"
        aria-label="Branches"
      >
        {#if loadingBranches && resultCount === 0}
          <div
            class="flex items-center justify-center gap-2 px-3 py-10 text-ui text-muted-foreground"
          >
            <Spinner class="size-4" /> Loading branches…
          </div>
        {:else if resultCount === 0}
          <Empty.Root class="py-8">
            <Empty.Header>
              <Empty.Title>
                {branchFilter.trim()
                  ? `No branches match “${branchFilter.trim()}”`
                  : "No branches found"}
              </Empty.Title>
            </Empty.Header>
          </Empty.Root>
        {:else}
          {#each shownGroups as group (group.label)}
            <GroupLabel
              label={group.label}
              count={group.label === "Current" ? undefined : group.rows.length}
              class="px-1.5 pt-2 pb-1"
            />
            {#each group.rows as row (row.branch.name)}
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
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <form
      class="grid gap-3 p-3"
      onsubmit={(event) => {
        event.preventDefault();
        if (isValidName && !creatingBranch) onCreateBranch(selectedRepo);
      }}
    >
      <label class="grid gap-1.5">
        <span class="text-ui">Branch name</span>
        <Input
          bind:value={newBranchName}
          placeholder="feat/my-change"
          autofocus
          aria-invalid={showNameError}
        />
      </label>
      {#if showNameError}
        <p class="m-0 text-ui text-destructive">
          Enter a valid branch name (no spaces or special characters).
        </p>
      {:else}
        <p class="m-0 flex items-center gap-1.5 text-ui text-muted-foreground">
          <GitBranch class="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Starts from <span class="text-foreground">{currentBranchLabel}</span
            > and switches to it.
          </span>
        </p>
      {/if}
    </form>
  {/if}

  {#snippet footer()}
    {#if view === "switch"}
      <span class="mr-auto text-ui text-muted-foreground tabular-nums">
        {resultCount} of {branchGroups.all.length}
        {branchGroups.all.length === 1 ? "branch" : "branches"}
      </span>
      <Button
        variant="outline"
        disabled={!branchesEnabled}
        onclick={() => (view = "create")}
      >
        <Plus aria-hidden="true" />New branch
      </Button>
    {:else}
      <Button variant="ghost" onclick={() => (view = "switch")}>Cancel</Button>
      <Button
        disabled={!branchesEnabled || creatingBranch || !isValidName}
        onclick={() => onCreateBranch(selectedRepo)}
      >
        {#if creatingBranch}<Spinner />{/if}
        Create and switch
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
