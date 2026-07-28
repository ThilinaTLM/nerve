<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import Search from "@lucide/svelte/icons/search";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

type Props = {
  open?: boolean;
  repoSummary: GitRepoSummary;
  selectedRepo: string;
  filteredBranches: GitBranchSummary[];
  baseBranchSummary?: GitBranchSummary;
  loadingBranches: boolean;
  switchingBranch?: string;
  creatingBranch: boolean;
  branchesEnabled: boolean;
  branchFilter?: string;
  newBranchName?: string;
  onSwitchBranch: (repo: string, branch: GitBranchSummary) => void;
  onCreateBranch: (repo: string) => void;
};

let {
  open = $bindable(false),
  repoSummary,
  selectedRepo,
  filteredBranches,
  baseBranchSummary,
  loadingBranches,
  switchingBranch,
  creatingBranch,
  branchesEnabled,
  branchFilter = $bindable(""),
  newBranchName = $bindable(""),
  onSwitchBranch,
  onCreateBranch,
}: Props = $props();

let view = $state<"switch" | "create">("switch");

const currentBranchLabel = $derived(repoSummary.currentBranch ?? "detached");
const baseBranch = $derived(repoSummary.baseBranch);
const showBaseQuickSwitch = $derived(
  !repoSummary.detached && Boolean(baseBranch),
);

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
</script>

<Dialog
  bind:open
  title={dialogTitle}
  description={dialogDescription}
  class="max-w-md"
  onOpenChange={(next) => {
    if (!next) view = "switch";
  }}
>
  {#if view === "switch"}
    <div class="grid gap-4 p-4">
      {#if showBaseQuickSwitch}
        <div
          class="flex items-center gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2"
        >
          <GitBranch size={14} class="shrink-0 text-info" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-xs font-medium text-foreground">Base branch</span>
            <span class="truncate font-mono text-xs text-muted-foreground"
              >{baseBranch}</span
            >
          </div>
          {#if repoSummary.onBaseBranch}
            <span class="text-xs text-muted-foreground">You're here</span>
          {:else if baseBranchSummary}
            <Button
              size="xs"
              disabled={!branchesEnabled ||
                switchingBranch === baseBranchSummary.name}
              onclick={() => onSwitchBranch(selectedRepo, baseBranchSummary)}
            >
              {#if switchingBranch === baseBranchSummary.name}
                <Spinner class="size-3" />
              {:else}
                <GitBranch />
              {/if}
              Switch to base
            </Button>
          {/if}
        </div>
      {/if}

      <div class="relative">
        <Search
          size={13}
          strokeWidth={2.1}
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          bind:value={branchFilter}
          placeholder="Filter branches"
          class="h-8 pl-7 text-xs"
          aria-label="Filter branches"
        />
      </div>

      <div class="max-h-72 overflow-y-auto rounded-md border">
        {#if loadingBranches}
          <div
            class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
          >
            <Spinner class="size-3.5" /> Loading branches…
          </div>
        {:else if filteredBranches.length === 0}
          <div class="px-3 py-2 text-xs text-muted-foreground">
            No branches found.
          </div>
        {:else}
          {#each filteredBranches as branch (branch.name)}
            <button
              type="button"
              class="flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-muted/60 disabled:opacity-60"
              disabled={branch.current || switchingBranch === branch.name}
              onclick={() => onSwitchBranch(selectedRepo, branch)}
            >
              {#if switchingBranch === branch.name}
                <Spinner class="text-muted-foreground size-3.5" />
              {:else if branch.current}
                <Check size={13} class="text-success" />
              {:else}
                <GitBranch size={13} class="text-muted-foreground" />
              {/if}
              <span class="min-w-0 flex-1 truncate font-mono text-foreground"
                >{branch.name}</span
              >
              {#if branch.name === baseBranch}
                <Badge tone="running" size="xs">base</Badge>
              {/if}
              {#if branch.remote}
                <Badge tone="neutral" size="xs">remote</Badge>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <form
      class="grid gap-1.5 p-4"
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
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
      <Button disabled={!branchesEnabled} onclick={() => (view = "create")}>
        <GitBranchPlus /> New branch
      </Button>
    {:else}
      <Button variant="ghost" onclick={() => (view = "switch")}>Back</Button>
      <Button
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
