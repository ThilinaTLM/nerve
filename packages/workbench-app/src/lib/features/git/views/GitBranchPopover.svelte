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
import PopoverPanel from "@nervekit/ui-kit/components/composites/popover-panel";
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

function handleOpenChange(next: boolean): void {
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
</script>

<PopoverPanel
  bind:open
  size="lg"
  align="start"
  sideOffset={4}
  class="p-1"
  {triggerClass}
  {triggerTitle}
  trigger={triggerContent}
  ariaLabel={`Switch branch in ${repoPathLabel(repo)}`}
  onOpenChange={handleOpenChange}
>
  <div class="grid min-w-0 gap-1">
    <div class="px-1 pt-1">
      <SearchInput
        bind:value={filter}
        placeholder="Filter branches"
        ariaLabel={`Filter branches in ${repoPathLabel(repo)}`}
      />
    </div>

    {#if loading && rows.length === 0}
      <div
        class="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground"
      >
        <Spinner class="size-3.5" />
        Loading branches…
      </div>
    {:else if rows.length === 0}
      <p class="px-2 py-4 text-xs text-muted-foreground">{emptyMessage}</p>
    {:else}
      <div
        class="max-h-64 min-w-0 overflow-y-auto"
        role="listbox"
        aria-label={`Branches in ${repoPathLabel(repo)}`}
      >
        {#each rows as row (row.branch.name)}
          {@const branch = row.branch}
          {@const switching = switchingBranch === branch.name}
          <button
            type="button"
            role="option"
            aria-selected={branch.current}
            disabled={!enabled || branch.current || Boolean(switchingBranch)}
            class={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default ${
              branch.current
                ? "bg-primary/15 font-medium text-foreground"
                : "text-foreground hover:bg-accent/60"
            }`}
            title={branch.updatedAt ?? undefined}
            onclick={() => choose(branch)}
          >
            {#if switching}
              <Spinner class="size-3.5 shrink-0 text-muted-foreground" />
            {:else if branch.current}
              <Check
                class="size-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
            {:else}
              <GitBranch
                class="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate font-mono text-xs"
              >{branch.name}</span
            >
            {#if !branch.remote && branch.name === repo.baseBranch && !branch.current}
              <Badge variant="info" class="shrink-0">base</Badge>
            {/if}
            <span class="shrink-0 text-[0.6875rem] text-muted-foreground"
              >{row.updatedLabel.replace(/^Updated /, "")}</span
            >
          </button>
        {/each}
      </div>
    {/if}

    <div class="flex items-center gap-1 border-t border-border pt-1">
      <Button
        variant="ghost"
        size="xs"
        class="flex-1 justify-start text-muted-foreground"
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
        class="flex-1 justify-start text-muted-foreground"
        disabled={!enabled}
        onclick={() => {
          open = false;
          onManage();
        }}
      >
        <Settings2 aria-hidden="true" />
        All branches
      </Button>
    </div>
  </div>
</PopoverPanel>
