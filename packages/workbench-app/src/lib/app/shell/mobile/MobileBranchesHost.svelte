<script lang="ts">
import { untrack } from "svelte";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { GitBranchSummary } from "@nervekit/contracts/git";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  canDeleteBranch,
  groupBranchesForDialog,
  isPlausibleBranchName,
  type GitBranchDialogRow,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/features/git";
import { openMobileCenter } from "./mobile-route-activation.svelte";
import { backFromMobileScreen } from "./mobile-shell.svelte";

/**
 * Switch, create, and delete branches of the selected repository. Uses the
 * desktop branch dialog's grouping, ordering, and guards.
 */
let {
  model,
  actions: gitActions,
}: { model: GitPanelModel; actions: GitPanelActions } = $props();

const repository = $derived(model.selectedRepository);
const branchState = $derived(model.repoBranchState(repository));
const summary = $derived(branchState.repoSummary ?? model.repositorySummary);
const baseBranch = $derived(summary?.baseBranch);
const enabled = $derived(model.capabilities.branches.enabled);

let filter = $state("");
let showRemote = $state(false);
const groups = $derived(
  groupBranchesForDialog(
    branchState.branches,
    filter,
    baseBranch,
    branchState.prHeads,
  ),
);
const localRows = $derived(groups.local);
const remoteRows = $derived(showRemote ? groups.remote : []);

// Branches are fetched on demand; load them whenever the repository changes.
$effect(() => {
  const repo = repository;
  if (!repo) return;
  untrack(() => {
    void gitActions.refreshBranches(repo);
    void gitActions.refreshPrHeads(repo);
  });
});

let switchCandidate = $state<GitBranchSummary>();
let deleteCandidate = $state<GitBranchSummary>();
let createOpen = $state(false);
let newName = $state("");
let creating = $state(false);
const nameValid = $derived(isPlausibleBranchName(newName));

function refresh() {
  void gitActions.refreshBranches(repository);
  void gitActions.refreshPrHeads(repository);
}

function openPullRequest(number: number) {
  void openMobileCenter("pr", () =>
    gitActions.openPullRequest(repository, number),
  );
}

function menu(row: GitBranchDialogRow): ContextMenuItem[] {
  const { branch, pullRequest } = row;
  const items: ContextMenuItem[] = [
    {
      label: "Switch",
      icon: GitBranch,
      disabled: !enabled || branch.current,
      onSelect: () => (switchCandidate = branch),
    },
  ];
  if (pullRequest) {
    items.push({
      label: `Open pull request #${pullRequest.number}`,
      icon: GitPullRequest,
      onSelect: () => openPullRequest(pullRequest.number),
    });
  }
  items.push({
    label: "Delete",
    icon: Trash2,
    destructive: true,
    disabled: !enabled || !canDeleteBranch(branch, baseBranch),
    onSelect: () => (deleteCandidate = branch),
  });
  return items;
}

function detail(row: GitBranchDialogRow): string | undefined {
  const parts: string[] = [];
  if (row.branch.current) parts.push("Current");
  if (!row.branch.remote && row.branch.name === baseBranch) parts.push("Base");
  if (row.pullRequest) {
    parts.push(
      `PR #${row.pullRequest.number}${row.pullRequest.isDraft ? " (draft)" : ""}`,
    );
  }
  return parts.join(" · ") || undefined;
}

async function createBranch(event: SubmitEvent) {
  event.preventDefault();
  if (!nameValid || creating) return;
  creating = true;
  try {
    const created = await gitActions.createBranch(repository, newName.trim());
    if (created !== false) {
      createOpen = false;
      newName = "";
      refresh();
    }
  } finally {
    creating = false;
  }
}
</script>

{#snippet branchRows(rows: GitBranchDialogRow[])}
  {#each rows as row (row.branch.name)}
    {@const switching = branchState.switchingBranch === row.branch.name}
    {@const deleting = model.operations.deletingBranch === row.branch.name}
    <MobileListRow
      title={row.branch.name}
      detail={detail(row)}
      meta={row.updatedLabel}
      menuItems={menu(row)}
      onclick={() => {
        if (enabled && !row.branch.current) switchCandidate = row.branch;
      }}
    >
      {#snippet leading()}
        <span
          class="flex size-8 flex-none items-center justify-center rounded-md bg-card text-muted-foreground"
        >
          {#if switching || deleting}
            <Spinner class="size-4" />
          {:else if row.branch.current}
            <CircleCheck size={17} strokeWidth={1.9} class="text-success" />
          {:else}
            <GitBranch size={17} strokeWidth={1.9} />
          {/if}
        </span>
      {/snippet}
    </MobileListRow>
  {/each}
{/snippet}

<MobileScreen
  title="Branches"
  subtitle={summary
    ? `${summary.name} · ${summary.currentBranch ?? "detached"}`
    : undefined}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Refresh branches"
      disabled={branchState.loadingBranches}
      onclick={refresh}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="New branch"
      disabled={!enabled}
      onclick={() => (createOpen = true)}
    >
      <Plus size={18} strokeWidth={1.9} />
    </Button>
  {/snippet}

  <div class="grid gap-2 px-3 pt-2">
    <SearchInput
      bind:value={filter}
      placeholder="Search branches"
      ariaLabel="Search branches"
    />
    <SwitchField
      bind:checked={showRemote}
      label="Show remote branches"
      class="px-1"
    />
  </div>

  {#if localRows.length}
    <MobileSection title="Local" meta={`${localRows.length}`}>
      {@render branchRows(localRows)}
    </MobileSection>
  {/if}
  {#if remoteRows.length}
    <MobileSection title="Remote" meta={`${remoteRows.length}`}>
      {@render branchRows(remoteRows)}
    </MobileSection>
  {/if}
  {#if !localRows.length && !remoteRows.length}
    {#if branchState.loadingBranches}
      <p class="px-6 py-10 text-center text-sm text-muted-foreground">
        Loading branches…
      </p>
    {:else}
      <Empty.Root class="px-6 py-10">
        <Empty.Header>
          <Empty.Media class="text-muted-foreground">
            <GitBranch size={28} strokeWidth={1.6} />
          </Empty.Media>
          <Empty.Title class="text-sm">No branches</Empty.Title>
          <Empty.Description class="text-xs">
            {filter.trim()
              ? "No branch matches this search."
              : "This repository has no branches to show."}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {/if}
  {/if}
</MobileScreen>

<ConfirmDialog
  open={Boolean(switchCandidate)}
  title={`Switch to ${switchCandidate?.name ?? ""}?`}
  description={`Checks out ${switchCandidate?.name ?? ""} in ${summary?.name ?? "this repository"}.`}
  confirmLabel="Switch"
  onConfirm={() => {
    const branch = switchCandidate;
    switchCandidate = undefined;
    if (branch)
      void Promise.resolve(gitActions.switchBranch(repository, branch)).then(
        refresh,
      );
  }}
  onOpenChange={(open) => {
    if (!open) switchCandidate = undefined;
  }}
/>

<ConfirmDialog
  open={Boolean(deleteCandidate)}
  destructive
  title="Delete branch?"
  description={`${deleteCandidate?.name ?? ""} will be deleted locally. Unmerged commits on it may be lost.`}
  confirmLabel="Delete"
  onConfirm={() => {
    const branch = deleteCandidate;
    deleteCandidate = undefined;
    if (branch)
      void Promise.resolve(gitActions.deleteBranch(repository, branch)).then(
        refresh,
      );
  }}
  onOpenChange={(open) => {
    if (!open) deleteCandidate = undefined;
  }}
/>

<Sheet.Root
  open={createOpen}
  onOpenChange={(open) => {
    if (!creating) createOpen = open;
  }}
>
  <Sheet.Content
    side="bottom"
    class="rounded-t-lg pb-[env(safe-area-inset-bottom)]"
  >
    <Sheet.Title class="px-4 pb-1 pt-3 text-sm font-semibold"
      >New branch</Sheet.Title
    >
    <form class="grid gap-3 px-4 pb-4" onsubmit={createBranch}>
      <div class="grid gap-1.5">
        <Label for="mobile-branch-name">Name</Label>
        <Input
          id="mobile-branch-name"
          bind:value={newName}
          placeholder="feature/my-change"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          class="font-mono"
          disabled={creating}
          aria-invalid={newName.trim().length > 0 && !nameValid}
        />
        <p class="text-xs text-muted-foreground">
          Created from {summary?.currentBranch ?? "the current commit"}.
        </p>
      </div>
      <div class="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={creating}
          onclick={() => (createOpen = false)}>Cancel</Button
        >
        <Button type="submit" disabled={!enabled || creating || !nameValid}>
          {creating ? "Creating…" : "Create branch"}
        </Button>
      </div>
    </form>
  </Sheet.Content>
</Sheet.Root>
