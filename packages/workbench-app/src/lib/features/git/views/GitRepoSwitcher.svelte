<script lang="ts">
import type { Snippet } from "svelte";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Cloud from "@lucide/svelte/icons/cloud";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import { GithubMark } from "@nervekit/ui-kit/components/composites/github-mark";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import { SvelteSet } from "svelte/reactivity";
import GitBranchDialog from "./GitBranchDialog.svelte";
import GitBranchPopover from "./GitBranchPopover.svelte";
import { repoButtonLabels, repoPathLabel } from "./git-change-format";
import {
  groupBranchesForDialog,
  shouldLoadRepoBranches,
} from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";

type Props = {
  /** Buttons between the name and the count of every row. */
  rowActions?: Snippet<[GitRepoSummary]>;
  /** Right-click / Shift+F10 menu items of a row. */
  contextItems?: Snippet<[GitRepoSummary]>;
  /** Right side of the selected row's branch line. */
  branchActions?: Snippet<[GitRepoSummary]>;
  model: GitPanelModel;
  actions: GitPanelActions;
  /** Trailing count of each row; blank only while undefined (unknown). */
  chipCount?: (repo: GitRepoSummary) => number | undefined;
  /** Shown instead of the number `0`, e.g. a check mark for a clean repo. */
  emptyCount?: Snippet;
  /** Tooltip of the trailing count. */
  countTitle?: (repo: GitRepoSummary, count: number) => string | undefined;
};

let {
  model,
  actions,
  chipCount,
  emptyCount,
  countTitle,
  rowActions,
  contextItems,
  branchActions,
}: Props = $props();

/** The list shows this many repositories before it scrolls. */
const MAX_LIST_ROWS = 6;

let branchesOpen = $state(false);
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
const branchRows = $derived(
  groupBranchesForDialog(
    model.repoBranchState(selectedRepo).branches,
    "",
    repoSummary?.baseBranch,
    model.repoBranchState(selectedRepo).prHeads,
  ).all,
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
    actions.loadPullRequestBadges(repository),
  ]);
}

/** Select a repository and open the branch dialog for it (context menu action). */
export async function openBranchDialog(repository: string): Promise<void> {
  if (repository !== selectedRepo) await actions.selectRepository(repository);
  openBranchManager("switch");
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

{#snippet listRow(repo: GitRepoSummary)}
  {@const selected = repo.relativePath === selectedRepo}
  {@const count = chipCount?.(repo)}
  {@const countHint =
    count === undefined ? undefined : countTitle?.(repo, count)}
  {@const canSelect = model.capabilities.selectRepository.enabled}
  <ContextMenu.Root>
    <ContextMenu.Trigger disabled={!contextItems} class="block min-w-0">
      <!-- Clicking anywhere on the row selects it; the name button is the keyboard target. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class={[
          "flex min-w-0 flex-col rounded-md",
          selected
            ? "bg-selected"
            : canSelect && "cursor-pointer hover:bg-muted/60",
        ]}
        onclick={() => {
          if (canSelect) selectRepository(repo.relativePath);
        }}
      >
        <div
          class="flex h-control-sm min-w-0 items-center gap-1.5 pl-2 text-sm"
        >
          <!-- Where the repository lives: GitHub, another remote, or local only. -->
          {#if !repo.hasRemote}
            <CloudOff
              class="size-3.5 shrink-0 text-muted-foreground/60"
              aria-label="No remote"
            />
          {:else if repo.hasGithubRemote}
            <GithubMark class="size-3.5 shrink-0 text-muted-foreground" />
          {:else}
            <Cloud
              class="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Remote (not GitHub)"
            />
          {/if}
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select repository ${repo.name}`}
                  disabled={!canSelect}
                  class="min-w-0 cursor-pointer rounded-sm text-left whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
                  >{listLabels.get(repo.relativePath)}</button
                >
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>
              <div class="min-w-0 space-y-1">
                <p class="font-medium break-all">{repo.name}</p>
                <p class="font-mono text-xs break-all">{repo.absDir}</p>
                <p class="text-xs">
                  {!repo.hasRemote
                    ? "Local only · no remote"
                    : repo.hasGithubRemote
                      ? "GitHub repository"
                      : "Remote is not on GitHub"}
                </p>
                {#if contextItems}
                  <p class="text-xs">Right-click for more actions</p>
                {/if}
              </div>
            </Tooltip.Content>
          </Tooltip.Root>
          <span class="min-w-0 flex-1"></span>

          <!-- Same cluster geometry as the PanelHeader trailing buttons, so row
               icons sit under the header actions and the count under Refresh.
               Actions target their own repository, so they never select it. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <span
            class="flex shrink-0 items-center gap-0.5"
            role="group"
            aria-label={`Actions for ${repo.name}`}
            onclick={(event) => event.stopPropagation()}
          >
            {@render rowActions?.(repo)}
            <Tooltip.Root disabled={!countHint}>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <span
                    {...props}
                    class="flex w-control-sm shrink-0 items-center justify-center text-xs text-muted-foreground tabular-nums"
                    aria-label={countHint ?? (count ? `${count}` : undefined)}
                  >
                    {#if count === 0 && emptyCount}
                      {@render emptyCount()}
                    {:else if count !== undefined}
                      {count}
                    {/if}
                  </span>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>{countHint}</Tooltip.Content>
            </Tooltip.Root>
          </span>
        </div>

        {#if selected && repoSummary}
          <!-- The branch belongs to the selected repository, so it lives inside its tint. -->
          <div class="flex h-control-sm min-w-0 items-center gap-1 pl-1.5">
            <GitBranchPopover
              repo={repoSummary}
              rows={branchRows}
              bind:open={branchesOpen}
              loading={model.repoBranchState(selectedRepo).loadingBranches}
              enabled={model.capabilities.branches.enabled}
              switchingBranch={model.repoBranchState(selectedRepo)
                .switchingBranch}
              triggerClass="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              triggerTitle={`Switch branch in ${repoPathLabel(repoSummary)}`}
              onOpen={() => loadBranches(selectedRepo)}
              onSwitch={(branch) => void switchBranch(selectedRepo, branch)}
              onManage={() => openBranchManager("switch")}
              onCreate={() => openBranchManager("create")}
            >
              {#snippet triggerContent()}
                <GitBranch class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 truncate font-mono">{branchLabel}</span>
                <ChevronDown class="size-3 shrink-0" aria-hidden="true" />
              {/snippet}
            </GitBranchPopover>
            <span class="min-w-0 flex-1"></span>
            {@render branchActions?.(repo)}
          </div>
        {/if}
      </div>
    </ContextMenu.Trigger>
    {#if contextItems}<ContextMenu.Content
        >{@render contextItems(repo)}</ContextMenu.Content
      >{/if}
  </ContextMenu.Root>
{/snippet}

<!-- The panel shell owns horizontal padding, so rows line up with the
     header buttons above them. -->
<Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
  <div class="flex shrink-0 flex-col pt-1.5">
    {#if repos.length > MAX_LIST_ROWS}
      <!-- About six rows (the selected one is taller); the rest scrolls. -->
      <ScrollRegion
        ariaLabel="Repositories"
        height="calc(7 * var(--spacing-control-sm) + 5 * 0.125rem + 1rem)"
        contentClass="flex flex-col gap-0.5"
      >
        {#each repos as repo (repo.relativePath)}{@render listRow(repo)}{/each}
      </ScrollRegion>
    {:else}
      <div class="flex flex-col gap-0.5" role="group" aria-label="Repositories">
        {#each repos as repo (repo.relativePath)}{@render listRow(repo)}{/each}
      </div>
    {/if}
  </div>
</Tooltip.Provider>

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
