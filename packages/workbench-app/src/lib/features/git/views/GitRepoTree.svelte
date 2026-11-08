<script lang="ts">
import type { Snippet } from "svelte";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import House from "@lucide/svelte/icons/house";
import Cloud from "@lucide/svelte/icons/cloud";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import type { GithubPr, GitRepoSummary } from "@nervekit/contracts/git";
import { GithubMark } from "@nervekit/ui-kit/components/composites/github-mark";
import { selectRowVariants } from "@nervekit/ui-kit/components/composites/select-row";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";
import {
  collapsedSummary,
  isPrimaryWorktree,
  splitBranchName,
  syncState,
  worktreeFolder,
  type BranchStatusContext,
  type FilteredGroup,
  type GitRepoGroup,
  type SyncState,
} from "./git-repo-tree";
import {
  canSync,
  idleRemoteGlyph,
  prGlyph,
  syncGlyph,
  type StatusGlyph,
} from "./git-status-glyphs";
import { navigateTree, type TreeRow } from "./git-tree-navigation";

type Props = {
  groups: readonly FilteredGroup[];
  /** Search or a filter is active: matching repositories show their branches. */
  forceExpanded: boolean;
  expanded: ReadonlySet<string>;
  selected: string;
  selectable: boolean;
  context: BranchStatusContext;
  failureDetail: (repo: GitRepoSummary) => {
    operation?: string;
    failure?: string;
  };
  repositoryMenu: Snippet<[GitRepoGroup]>;
  branchMenu: Snippet<[GitRepoSummary]>;
  onToggleGroup: (key: string, expanded: boolean) => void;
  onSelect: (repository: string) => void;
  onOpenChanges: (repository: string) => void;
  onOpenBranchPicker: (repository: string) => void;
  onSyncAction: (repo: GitRepoSummary, state: SyncState) => void;
  /** Fetch a repository (collapsed, several worktrees, nothing to sync). */
  onFetch: (repo: GitRepoSummary) => void;
  onOpenPullRequest: (repo: GitRepoSummary, pr: GithubPr) => void;
  /** Hover or keyboard focus rests on a branch: it may be selected soon. */
  onHint?: (repository: string) => void;
};

let {
  groups,
  forceExpanded,
  expanded,
  selected,
  selectable,
  context,
  failureDetail,
  repositoryMenu,
  branchMenu,
  onToggleGroup,
  onSelect,
  onOpenChanges,
  onOpenBranchPicker,
  onSyncAction,
  onFetch,
  onOpenPullRequest,
  onHint,
}: Props = $props();

const isOpen = (key: string) => forceExpanded || expanded.has(key);
/** Row ids are namespaced: a repository key may equal a worktree path. */
const groupRowId = (key: string) => `g:${key}`;
const branchRowId = (path: string) => `b:${path}`;
const unprefixed = (id: string) => id.slice(2);

const rows = $derived.by<TreeRow[]>(() =>
  groups.flatMap(({ group, repos }) => {
    const open = isOpen(group.key);
    return [
      {
        id: groupRowId(group.key),
        kind: "repository",
        expanded: open,
      } as TreeRow,
      ...(open
        ? repos.map(
            (repo): TreeRow => ({
              id: branchRowId(repo.relativePath),
              kind: "branch",
              parent: groupRowId(group.key),
            }),
          )
        : []),
    ];
  }),
);

let treeElement = $state<HTMLElement>();
let focusedId = $state<string>();
/** Roving tabindex target: the focused row, else the selection, else the first. */
const tabStop = $derived(
  rows.find((row) => row.id === focusedId)?.id ??
    rows.find((row) => row.id === branchRowId(selected))?.id ??
    rows[0]?.id,
);

function focusRow(id: string): void {
  focusedId = id;
  treeElement
    ?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
    ?.focus();
}

function onRowKeydown(event: KeyboardEvent, id: string): void {
  // Keys inside a status button belong to the button.
  if (event.target !== event.currentTarget) return;
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    return;
  const action = navigateTree(rows, id, event.key);
  if (!action) return;
  event.preventDefault();
  switch (action.type) {
    case "focus":
      focusRow(action.id);
      break;
    case "expand":
      onToggleGroup(unprefixed(action.id), true);
      break;
    case "collapse":
      onToggleGroup(unprefixed(action.id), false);
      break;
    case "toggle":
      onToggleGroup(unprefixed(action.id), !isOpen(unprefixed(action.id)));
      break;
    case "select":
      if (selectable) onSelect(unprefixed(action.id));
      break;
  }
}

const HINT_DELAY_MS = 120;
let hintTimer: ReturnType<typeof setTimeout> | undefined;
function hint(repository: string, delay: number): void {
  clearTimeout(hintTimer);
  if (!onHint || repository === selected) return;
  hintTimer = setTimeout(() => onHint(repository), delay);
}
$effect(() => () => clearTimeout(hintTimer));
</script>

{#snippet remoteIcon(repo: GitRepoSummary, active: boolean)}
  {@const tone = cn(
    "size-3.5 shrink-0",
    active ? "text-primary" : "text-muted-foreground",
  )}
  {#if !repo.hasRemote}
    <CloudOff class={tone} aria-label="No remote" />
  {:else if repo.hasGithubRemote}
    <GithubMark class={tone} />
  {:else}
    <Cloud class={tone} aria-label="Remote (not GitHub)" />
  {/if}
{/snippet}

<!-- The repository icon carries the expand state as a corner chevron badge. -->
{#snippet repositoryIcon(repo: GitRepoSummary, open: boolean, active: boolean)}
  <span class="relative flex size-4 shrink-0 items-center justify-center">
    {@render remoteIcon(repo, active)}
    <span
      class="absolute -right-1 -bottom-1 flex size-2.5 items-center justify-center rounded-full bg-panel text-muted-foreground"
      aria-hidden="true"
    >
      {#if open}
        <ChevronDown class="size-2.5" strokeWidth={3} />
      {:else}
        <ChevronRight class="size-2.5" strokeWidth={3} />
      {/if}
    </span>
  </span>
{/snippet}

<!-- Status items packed to the right edge with one gap. Absent items take no
     space, so the cluster never has holes. -->
{#snippet glyphButton(glyph: StatusGlyph, rowId: string, onclick: () => void)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          tabindex={tabStop === rowId ? 0 : -1}
          class={cn(
            "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-hover focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none",
            glyph.tone,
          )}
          aria-label={glyph.label}
          onclick={(event) => {
            event.stopPropagation();
            onclick();
          }}
        >
          {#if glyph.spinner}
            <Spinner class="size-3" />
          {:else if glyph.icon}
            {@const Icon = glyph.icon}
            <Icon class="size-3" />
          {/if}
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{glyph.label}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{#snippet changeCount(count: number, rowId: string, onclick: () => void)}
  {#if count > 0}
    {@const label = `${count} changed ${count === 1 ? "file" : "files"}`}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            tabindex={tabStop === rowId ? 0 : -1}
            class="flex h-5 min-w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm px-0.5 text-caption text-foreground tabular-nums hover:bg-hover focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none"
            aria-label={label}
            onclick={(event) => {
              event.stopPropagation();
              onclick();
            }}>{count}</button
          >
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  {/if}
{/snippet}

{#snippet branchName(repo: GitRepoSummary, emphasised: boolean)}
  {#if repo.detached || !repo.currentBranch}
    <span class="min-w-0 truncate text-warning">detached</span>
  {:else}
    {@const parts = splitBranchName(repo.currentBranch)}
    <span
      class={cn(
        "flex min-w-0 overflow-hidden",
        emphasised && "text-foreground",
      )}
      title={repo.currentBranch}
    >
      <span class={cn("truncate", parts.tail && "min-w-[6ch]")}
        >{parts.head}</span
      ><span class="shrink-0">{parts.tail}</span>
    </span>
  {/if}
{/snippet}

{#snippet repositoryRow({ group, repos }: FilteredGroup)}
  {@const open = isOpen(group.key)}
  {@const holdsSelection = repos.some((repo) => repo.relativePath === selected)}
  {@const summary = collapsedSummary(group.repos, context)}
  {@const sync = syncGlyph(
    summary.sync,
    failureDetail(summary.syncRepo ?? group.primary),
  )}
  {@const pr = prGlyph(summary.pullRequest)}
  {@const only = group.repos.length === 1 ? group.repos[0] : undefined}
  <ContextMenu.Root>
    <ContextMenu.Trigger class="block min-w-0">
      <div
        role="treeitem"
        aria-selected={!open && holdsSelection}
        aria-expanded={open}
        aria-level={1}
        aria-label={`${group.name}, ${group.repos.length} ${group.repos.length === 1 ? "branch" : "branches"}`}
        data-row-id={groupRowId(group.key)}
        tabindex={tabStop === groupRowId(group.key) ? 0 : -1}
        class={cn(
          "flex h-control-sm w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 text-ui transition-colors hover:bg-hover focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none",
          !open && holdsSelection && "bg-selected hover:bg-selected",
        )}
        onfocus={() => (focusedId = groupRowId(group.key))}
        onclick={() => onToggleGroup(group.key, !open)}
        onkeydown={(event) => onRowKeydown(event, groupRowId(group.key))}
      >
        {@render repositoryIcon(group.primary, open, holdsSelection)}
        {#if !open && only?.currentBranch && !only.detached}
          <!-- Collapsed single checkout: its branch follows the name when it
               fits whole; otherwise it wraps onto a clipped second line. -->
          <span
            class="flex h-[1lh] min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 overflow-hidden"
          >
            <span
              class="max-w-full min-w-0 truncate text-foreground"
              title={group.primary.absDir}>{group.name}</span
            >
            <span
              class="shrink-0 text-muted-foreground"
              title={only.currentBranch}>{only.currentBranch}</span
            >
          </span>
        {:else}
          <span
            class="min-w-0 truncate text-foreground"
            title={group.primary.absDir}>{group.name}</span
          >
        {/if}
        <!-- Expanded, the branch rows carry the status; nothing is shown twice. -->
        {#if !open}
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            {#if sync}
              {@render glyphButton(sync, groupRowId(group.key), () =>
                onToggleGroup(group.key, true),
              )}
            {:else if only && canSync(only)}
              {@render glyphButton(
                idleRemoteGlyph("sync"),
                groupRowId(group.key),
                () => onSyncAction(only, summary.sync),
              )}
            {:else if !only && group.primary.hasRemote}
              {@render glyphButton(
                idleRemoteGlyph("fetch"),
                groupRowId(group.key),
                () => onFetch(group.primary),
              )}
            {/if}
            {#if pr}
              {@render glyphButton(pr, groupRowId(group.key), () =>
                onToggleGroup(group.key, true),
              )}
            {/if}
            {@render changeCount(summary.changes, groupRowId(group.key), () =>
              onToggleGroup(group.key, true),
            )}
          </span>
        {/if}
      </div>
    </ContextMenu.Trigger>
    <ContextMenu.Content>{@render repositoryMenu(group)}</ContextMenu.Content>
  </ContextMenu.Root>
{/snippet}

{#snippet branchRow(group: GitRepoGroup, repo: GitRepoSummary)}
  {@const isSelected = repo.relativePath === selected}
  {@const styles = selectRowVariants({ selected: isSelected })}
  {@const state = syncState(repo, context)}
  {@const sync = syncGlyph(state, failureDetail(repo))}
  {@const pullRequest = context.pullRequest(repo)}
  {@const pr = prGlyph(pullRequest)}
  <ContextMenu.Root>
    <ContextMenu.Trigger class="block min-w-0">
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-level={2}
        aria-label={`${repo.currentBranch ?? "detached"} in ${group.name}${group.primary === repo ? "" : `, worktree ${worktreeFolder(repo)}`}`}
        data-row-id={branchRowId(repo.relativePath)}
        tabindex={tabStop === branchRowId(repo.relativePath) ? 0 : -1}
        class={styles.base({
          class: cn(
            "flex h-control-sm min-w-0 items-center gap-1.5 pr-1 pl-6 text-ui select-none",
            !isSelected && "text-muted-foreground hover:text-foreground",
            selectable ? "cursor-pointer" : "hover:bg-transparent",
          ),
        })}
        onfocus={() => {
          focusedId = branchRowId(repo.relativePath);
          hint(repo.relativePath, 0);
        }}
        onpointerenter={() => hint(repo.relativePath, HINT_DELAY_MS)}
        onpointerleave={() => clearTimeout(hintTimer)}
        onclick={() => {
          if (selectable) onSelect(repo.relativePath);
        }}
        ondblclick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          if (selectable) onOpenBranchPicker(repo.relativePath);
        }}
        onkeydown={(event) =>
          onRowKeydown(event, branchRowId(repo.relativePath))}
      >
        {@render branchName(repo, isSelected)}
        {#if isPrimaryWorktree(repo) && group.repos.length > 1}
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <span {...props} class="flex shrink-0 text-muted-foreground">
                  <House
                    class="size-3"
                    aria-label={`Primary worktree, ${group.primary.absDir}`}
                  />
                </span>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content
              >Primary worktree · {group.primary.absDir}</Tooltip.Content
            >
          </Tooltip.Root>
        {/if}
        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          {#if sync}
            {@render glyphButton(sync, branchRowId(repo.relativePath), () =>
              onSyncAction(repo, state),
            )}
          {:else if canSync(repo)}
            {@render glyphButton(
              idleRemoteGlyph("sync"),
              branchRowId(repo.relativePath),
              () => onSyncAction(repo, state),
            )}
          {/if}
          {#if pr && pullRequest}
            {@render glyphButton(pr, branchRowId(repo.relativePath), () =>
              onOpenPullRequest(repo, pullRequest),
            )}
          {/if}
          {@render changeCount(
            repo.changeCount,
            branchRowId(repo.relativePath),
            () => onOpenChanges(repo.relativePath),
          )}
        </span>
      </div>
    </ContextMenu.Trigger>
    <ContextMenu.Content>{@render branchMenu(repo)}</ContextMenu.Content>
  </ContextMenu.Root>
{/snippet}

<Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
  <div
    bind:this={treeElement}
    role="tree"
    aria-label="Repositories"
    class="flex flex-col gap-1"
  >
    {#each groups as entry (entry.group.key)}
      <div class="flex flex-col">
        {@render repositoryRow(entry)}
        {#if isOpen(entry.group.key)}
          <div role="group" class="flex flex-col">
            {#each entry.repos as repo (repo.relativePath)}
              {@render branchRow(entry.group, repo)}
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <p class="px-2 py-3 text-ui text-muted-foreground">
        No repository matches.
      </p>
    {/each}
  </div>
</Tooltip.Provider>
