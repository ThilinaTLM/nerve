<script lang="ts">
import type { Snippet } from "svelte";
import Check from "@lucide/svelte/icons/check";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Plus from "@lucide/svelte/icons/plus";
import Settings2 from "@lucide/svelte/icons/settings-2";
import type { GitBranchSummary, GitRepoSummary } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import PopoverPanel, {
  createListNavigation,
  PopoverBody,
  PopoverFooter,
  PopoverHeader,
  PopoverSearch,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import type { GitBranchDialogRow } from "./git-panel-controller";
import { repoPathLabel } from "./git-change-format";

type Props = {
  repo: GitRepoSummary;
  rows: readonly GitBranchDialogRow[];
  open?: boolean;
  filter?: string;
  loading: boolean;
  enabled: boolean;
  switchingBranch?: string;
  onOpen: () => void;
  onSwitch: (branch: GitBranchSummary) => void;
  onManage: () => void;
  onCreate: () => void;
  triggerContent: Snippet;
  triggerClass?: string;
  triggerTitle?: string;
};

let {
  repo,
  rows,
  open = $bindable(false),
  filter = $bindable(""),
  loading,
  enabled,
  switchingBranch,
  onOpen,
  onSwitch,
  onManage,
  onCreate,
  triggerContent,
  triggerClass,
  triggerTitle,
}: Props = $props();

const emptyMessage = $derived(
  filter.trim() ? "No branches match your search." : "No local branches yet.",
);

let listEl = $state<HTMLDivElement | null>(null);

function rowId(row: GitBranchDialogRow): string {
  return `git-branch:${encodeURIComponent(row.branch.name)}`;
}

const navigation = createListNavigation({
  items: () => rows as GitBranchDialogRow[],
  getId: rowId,
  viewport: () => listEl ?? undefined,
  onChoose: (row) => choose(row.branch),
});

function handleOpenChange(next: boolean): void {
  navigation.reset();
  if (next) {
    filter = "";
    onOpen();
  }
}

function choose(branch: GitBranchSummary): void {
  if (branch.current) return;
  onSwitch(branch);
  open = false;
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    navigation.chooseActive();
    return;
  }
  navigation.handleKeydown(event);
}
</script>

<PopoverPanel
  bind:open
  size="md"
  align="start"
  {triggerClass}
  {triggerTitle}
  trigger={triggerContent}
  ariaLabel={`Switch branch in ${repoPathLabel(repo)}`}
  onOpenChange={handleOpenChange}
>
  <PopoverHeader title="Branches" meta={`${rows.length}`} />

  <PopoverSearch>
    <SearchInput
      bind:value={filter}
      onValueChange={() => navigation.reset()}
      onkeydown={handleSearchKeydown}
      controls="git-branch-list"
      activeDescendant={navigation.activeDescendant}
      placeholder="Filter branches"
      ariaLabel={`Filter branches in ${repoPathLabel(repo)}`}
    />
  </PopoverSearch>

  <PopoverBody
    bind:ref={listEl}
    id="git-branch-list"
    role="listbox"
    ariaLabel={`Branches in ${repoPathLabel(repo)}`}
    class="gap-0.5"
  >
    {#if loading && rows.length === 0}
      <p class="flex items-center gap-2 px-1.5 py-4 text-muted-foreground">
        <Spinner class="size-3.5" />
        Loading branches…
      </p>
    {:else if rows.length === 0}
      <p class="px-1.5 py-4 text-muted-foreground">{emptyMessage}</p>
    {:else}
      {#each rows as row, index (row.branch.name)}
        {@const branch = row.branch}
        {@const switching = switchingBranch === branch.name}
        <button
          type="button"
          id={rowId(row)}
          role="option"
          aria-selected={branch.current}
          disabled={!enabled || branch.current || Boolean(switchingBranch)}
          class={`flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none disabled:cursor-default ${
            branch.current ? "bg-selected font-medium hover:bg-selected" : ""
          } ${
            navigation.isActive(index)
              ? "outline outline-1 -outline-offset-1 outline-ring/55"
              : ""
          }`}
          title={branch.updatedAt ?? undefined}
          onclick={() => choose(branch)}
        >
          {#if switching}
            <Spinner class="size-3.5 shrink-0 text-muted-foreground" />
          {:else}
            <GitBranch
              class="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          {/if}
          <span class="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
          {#if !branch.remote && branch.name === repo.baseBranch && !branch.current}
            <Badge variant="info" class="shrink-0">base</Badge>
          {/if}
          <span class="shrink-0 text-[0.6875rem] text-muted-foreground">
            {row.updatedLabel.replace(/^Updated /, "")}
          </span>
          {#if branch.current}
            <Check class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          {/if}
        </button>
      {/each}
    {/if}
  </PopoverBody>

  <PopoverFooter>
    <Button
      variant="ghost"
      size="xs"
      class="justify-start text-muted-foreground"
      disabled={!enabled}
      onclick={() => {
        open = false;
        onCreate();
      }}
    >
      <Plus aria-hidden="true" />
      New branch
    </Button>
    <Button
      variant="ghost"
      size="xs"
      class="justify-start text-muted-foreground"
      disabled={!enabled}
      onclick={() => {
        open = false;
        onManage();
      }}
    >
      <Settings2 aria-hidden="true" />
      All branches
    </Button>
  </PopoverFooter>
</PopoverPanel>
