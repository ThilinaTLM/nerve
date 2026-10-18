<script lang="ts">
import type { Snippet } from "svelte";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Circle from "@lucide/svelte/icons/circle";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Settings2 from "@lucide/svelte/icons/settings-2";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import PopoverPanel, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { SvelteSet } from "svelte/reactivity";
import GitBranchDialog from "./GitBranchDialog.svelte";
import GitBranchPopover from "./GitBranchPopover.svelte";
import {
  repoButtonLabel,
  repoButtonLabels,
  repoPathLabel,
} from "./git-change-format";
import {
  gitRepoChipSplit,
  groupBranchesForDialog,
  shouldLoadRepoBranches,
} from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";

type Props = {
  rowActions?: Snippet<[GitRepoSummary]>;
  contextItems?: Snippet<[GitRepoSummary]>;
  model: GitPanelModel;
  actions: GitPanelActions;
  /** Git Changes uses a stable vertical list; other callers retain chips. */
  layout?: "chips" | "list";
  /** Per-repository badge shown on each chip, e.g. change or PR counts. */
  chipCount?: (repo: GitRepoSummary) => number | undefined;
};

let {
  model,
  actions,
  chipCount,
  rowActions,
  contextItems,
  layout = "chips",
}: Props = $props();

/* Chips stay on at most a couple of rows: beyond this many repositories the
 * rest move into an overflow popover so the switcher height stays constant. */
const MAX_VISIBLE_CHIPS = 8;

let branchesOpen = $state(false);
let branchFilter = $state("");
let overflowOpen = $state(false);
let branchDialogOpen = $state(false);
let branchDialogView = $state<"switch" | "create">("switch");
let dialogFilter = $state("");
let newBranchName = $state("");
/** Repositories whose branch list has already been requested this session. */
const branchesRequested = new SvelteSet<string>();

const repos = $derived([...model.repositories]);
const listLabels = $derived(repoButtonLabels(repos, { maxLength: 14 }));
const selectedRepo = $derived(model.selectedRepository);
const repoSummary = $derived(model.repositorySummary);
const selectEnabled = $derived(
  repos.length > 1 && model.capabilities.selectRepository.enabled,
);

const chipSplit = $derived(
  gitRepoChipSplit(repos, selectedRepo, MAX_VISIBLE_CHIPS),
);
const visibleRepos = $derived(chipSplit.visible);
const overflowRepos = $derived(chipSplit.overflow);

const branchRows = $derived(
  groupBranchesForDialog(
    model.repoBranchState(selectedRepo).branches,
    "",
    repoSummary?.baseBranch,
    model.repoBranchState(selectedRepo).prHeads,
  ).local,
);
const branchGroups = $derived(
  groupBranchesForDialog(
    model.branches,
    dialogFilter,
    repoSummary?.baseBranch,
    model.prHeads,
  ),
);
const branchLabel = $derived(repoSummary?.currentBranch ?? "(detached)");

function selectRepository(repository: string): void {
  if (repository === selectedRepo) return;
  dialogFilter = "";
  newBranchName = "";
  void actions.selectRepository(repository);
}

/** Branch lists are per repository, so the picker loads its own on first open. */
function loadBranches(repository: string): void {
  const state = model.repoBranchState(repository);
  if (
    !shouldLoadRepoBranches(
      branchesRequested,
      repository,
      state.branches.length,
    )
  )
    return;
  branchesRequested.add(repository);
  refreshBranchDialog(repository);
}

function refreshBranchDialog(repository = selectedRepo): void {
  void Promise.all([
    actions.refreshBranches(repository),
    actions.refreshPrHeads(repository),
  ]);
}

function openBranchManager(view: "switch" | "create"): void {
  branchDialogView = view;
  dialogFilter = "";
  newBranchName = "";
  branchDialogOpen = true;
  refreshBranchDialog(selectedRepo);
}

async function switchBranch(
  repository: string,
  branch: GitBranchSummary,
): Promise<void> {
  const switched = await actions.switchBranch(repository, branch);
  if (switched === false) return;
  branchDialogOpen = false;
  dialogFilter = "";
  newBranchName = "";
}

async function createBranch(repository: string): Promise<void> {
  const name = newBranchName.trim();
  if (!name) return;
  const created = await actions.createBranch(repository, name);
  if (created === false) return;
  branchDialogOpen = false;
  dialogFilter = "";
  newBranchName = "";
}
</script>

{#snippet chip(repo: GitRepoSummary)}
  {@const count = chipCount?.(repo)}
  <ToggleGroup.Item
    value={repo.relativePath}
    disabled={!selectEnabled}
    title={`Switch to ${repoPathLabel(repo)}`}
    class="max-w-full gap-1.5 px-2 font-mono text-xs"
  >
    <span class="min-w-0 truncate">{repoButtonLabel(repo, repos)}</span>
    {#if count}
      <span data-slot="toggle-count">{count}</span>
    {/if}
  </ToggleGroup.Item>
{/snippet}

<!-- The panel shell owns horizontal padding, so chips line up with the
     toolbar buttons below them. -->
<div class="flex shrink-0 flex-col gap-1 pt-1.5">
  {#if layout === "list"}
    <div class="flex flex-col gap-0.5" role="group" aria-label="Repositories">
      {#each repos as repo (repo.relativePath)}
        {@const selected = repo.relativePath === selectedRepo}
        {@const count = chipCount?.(repo)}
        <ContextMenu.Root>
          <ContextMenu.Trigger disabled={!contextItems} class="block min-w-0">
            <div
              class={selected
                ? "flex min-w-0 items-center gap-1 rounded-md bg-selected"
                : "flex min-w-0 items-center gap-1 rounded-md"}
            >
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="ghost"
                      size="sm"
                      aria-pressed={selected}
                      aria-label={`Select repository ${repo.name}`}
                      disabled={!model.capabilities.selectRepository.enabled}
                      class="min-w-0 flex-1 justify-start gap-1 font-normal hover:bg-transparent"
                      onkeydown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          event.stopPropagation();
                        if (typeof props.onkeydown === "function")
                          props.onkeydown(event);
                      }}
                      onclick={() => selectRepository(repo.relativePath)}
                    >
                      {#if selected}<CircleCheck
                          class="size-3.5 shrink-0"
                          aria-hidden="true"
                        />{:else}<Circle
                          class="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />{/if}
                      <span class="whitespace-nowrap"
                        >{listLabels.get(repo.relativePath)}</span
                      >
                    </Button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <div class="min-w-0 space-y-1">
                    <p class="break-all font-medium">{repo.name}</p>
                    <p class="break-all font-mono text-xs">{repo.absDir}</p>
                  </div>
                </Tooltip.Content>
              </Tooltip.Root>
              {#if rowActions}{@render rowActions(repo)}{/if}
              {#if count !== undefined}<span
                  class="flex w-control-sm shrink-0 items-center justify-center text-xs text-muted-foreground tabular-nums"
                  >{count}</span
                >{/if}
            </div>
          </ContextMenu.Trigger>
          {#if contextItems}<ContextMenu.Content
              >{@render contextItems(repo)}</ContextMenu.Content
            >{/if}
        </ContextMenu.Root>
      {/each}
    </div>
  {:else if repos.length > 1}
    <div class="flex min-w-0 flex-wrap items-center gap-1">
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="chip"
        spacing={1}
        value={selectedRepo}
        aria-label="Repository"
        class="min-w-0 flex-wrap"
        onValueChange={(value) => {
          if (value) selectRepository(value);
        }}
      >
        {#each visibleRepos as repo (repo.relativePath)}
          {@render chip(repo)}
        {/each}
      </ToggleGroup.Root>

      {#if overflowRepos.length > 0}
        <PopoverPanel
          bind:open={overflowOpen}
          size="sm"
          align="start"
          triggerClass="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          triggerTitle={`${overflowRepos.length} more repositories`}
          ariaLabel="More repositories"
        >
          {#snippet trigger()}
            +{overflowRepos.length}
            <ChevronDown class="size-3" aria-hidden="true" />
          {/snippet}
          <PopoverHeader title="Repositories" meta={`${repos.length}`} />
          <PopoverBody role="listbox" ariaLabel="More repositories">
            {#each overflowRepos as repo (repo.relativePath)}
              {@const count = chipCount?.(repo)}
              <PopoverRow
                selected={repo.relativePath === selectedRepo}
                disabled={!selectEnabled}
                onclick={() => {
                  overflowOpen = false;
                  selectRepository(repo.relativePath);
                }}
              >
                {#snippet label()}
                  <span class="min-w-0 truncate font-mono">
                    {repoPathLabel(repo)}
                  </span>
                {/snippet}
                {#snippet trailing()}
                  {#if count}
                    <span class="shrink-0 text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  {/if}
                {/snippet}
              </PopoverRow>
            {/each}
          </PopoverBody>
        </PopoverPanel>
      {/if}
    </div>
  {/if}

  {#if repoSummary}
    <div class="flex min-w-0 items-center gap-1">
      <GitBranchPopover
        repo={repoSummary}
        rows={branchRows}
        bind:open={branchesOpen}
        bind:filter={branchFilter}
        loading={model.repoBranchState(selectedRepo).loadingBranches}
        enabled={model.capabilities.branches.enabled}
        switchingBranch={model.repoBranchState(selectedRepo).switchingBranch}
        triggerClass={`flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-2 text-xs transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${
          repoSummary.detached ? "text-muted-foreground" : "text-foreground"
        }`}
        triggerTitle={`Switch branch in ${repoPathLabel(repoSummary)}`}
        onOpen={() => loadBranches(selectedRepo)}
        onSwitch={(branch) => void switchBranch(selectedRepo, branch)}
        onManage={() => openBranchManager("switch")}
        onCreate={() => openBranchManager("create")}
      >
        {#snippet triggerContent()}
          <GitBranch class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left font-mono"
            >{branchLabel}</span
          >
          <ChevronDown
            class="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        {/snippet}
      </GitBranchPopover>

      <!-- Ahead/behind counts live on the Pull and Push buttons below; the
           branch control only picks a branch. -->
      <Button
        size="icon-sm"
        variant="ghost"
        title="Manage branches"
        aria-label={`Manage branches in ${repoPathLabel(repoSummary)}`}
        disabled={!model.capabilities.branches.enabled}
        onclick={() => openBranchManager("switch")}
      >
        <Settings2 aria-hidden="true" />
      </Button>
    </div>
  {/if}
</div>

{#if repoSummary}
  <GitBranchDialog
    bind:open={branchDialogOpen}
    {repoSummary}
    {selectedRepo}
    {branchGroups}
    loadingBranches={model.loadingBranches}
    loadingPrHeads={model.loadingPrHeads}
    switchingBranch={model.operations.switchingBranch}
    deletingBranch={model.operations.deletingBranch}
    creatingBranch={model.operations.creatingBranch}
    branchesEnabled={model.capabilities.branches.enabled}
    bind:branchFilter={dialogFilter}
    bind:newBranchName
    bind:view={branchDialogView}
    onSwitchBranch={(repository, branch) =>
      void switchBranch(repository, branch)}
    onDeleteBranch={async (repository, branch) =>
      (await actions.deleteBranch(repository, branch)) !== false}
    onOpenPullRequest={(repository, number) =>
      void actions.openPullRequest(repository, number)}
    onRefreshBranches={() => refreshBranchDialog(selectedRepo)}
    onCreateBranch={(repository) => void createBranch(repository)}
  />
{/if}
