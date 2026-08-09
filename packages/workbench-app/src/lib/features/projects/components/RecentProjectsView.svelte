<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderSearch from "@lucide/svelte/icons/folder-search";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { tildePath } from "$lib/core/utils/path";
import type { ProjectGitOverview } from "$lib/features/projects/state/project-overview";
import type { ProjectSwitcherItem } from "$lib/features/projects/state/project-switcher";
import ProjectCardStatus from "./ProjectCardStatus.svelte";

type Props = {
  scrollEl?: HTMLDivElement;
  items: ProjectSwitcherItem[];
  totalRecentCount: number;
  defaultProjectCount: number;
  query: string;
  pathQuery: boolean;
  selectedIndex: number;
  activeDescendant?: string;
  activeProjectKey?: string;
  homeDir?: string;
  loading: boolean;
  gitByProjectKey: Record<string, ProjectGitOverview>;
  gitLoadingByProjectKey: Record<string, boolean>;
  gitErrorByProjectKey: Record<string, boolean>;
  onOpen: (item: ProjectSwitcherItem) => void;
  onForget?: (projectId: string) => void;
  onCopyPath: (path: string) => void;
  onNewChat: (path: string) => void;
  onBrowse: () => void;
  onBrowsePath: () => void;
  onQueryChange?: () => void;
  onSubmit?: (event: Event) => void;
  onRowKeydown: (
    event: KeyboardEvent,
    index: number,
    item: ProjectSwitcherItem,
  ) => void;
};

let {
  scrollEl = $bindable(),
  items,
  totalRecentCount,
  defaultProjectCount,
  query = $bindable(),
  pathQuery,
  selectedIndex,
  activeDescendant,
  activeProjectKey,
  homeDir,
  loading,
  gitByProjectKey,
  gitLoadingByProjectKey,
  gitErrorByProjectKey,
  onOpen,
  onForget,
  onCopyPath,
  onNewChat,
  onBrowse,
  onBrowsePath,
  onQueryChange,
  onSubmit,
  onRowKeydown,
}: Props = $props();

const placeholderCount = $derived(
  query.trim() ? 0 : Math.max(0, defaultProjectCount - items.length),
);

function projectMenu(item: ProjectSwitcherItem): ContextMenuItem[] {
  const project = item.project;
  const menuItems: ContextMenuItem[] = [
    { label: "New chat", icon: Plus, onSelect: () => onNewChat(project.dir) },
    { label: "Copy path", icon: Copy, onSelect: () => onCopyPath(project.dir) },
  ];
  if (onForget) {
    menuItems.push(
      { type: "separator" },
      {
        label: "Forget project",
        icon: Trash2,
        destructive: true,
        onSelect: () => onForget(project.id),
      },
    );
  }
  return menuItems;
}
</script>

<form class="grid items-center px-3 py-2.5" onsubmit={onSubmit}>
  <SearchInput
    bind:value={query}
    onValueChange={() => onQueryChange?.()}
    placeholder="Search recent projects or paste a path"
    disabled={loading}
    ariaLabel="Search recent projects or enter a path"
  />
</form>

<div class="min-h-0 overflow-auto p-2" bind:this={scrollEl}>
  {#if pathQuery}
    <button
      type="button"
      class="group flex w-full items-center gap-2.5 rounded-md border border-transparent bg-transparent px-2.5 py-2 text-left hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      onclick={onBrowsePath}
    >
      <span
        class="grid size-8 flex-none place-items-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground group-hover:text-foreground"
      >
        <FolderOpen class="size-4" aria-hidden="true" />
      </span>
      <span class="grid min-w-0 flex-1 gap-0.5">
        <span class="text-sm font-medium text-foreground">Browse path</span>
        <span class="truncate font-mono text-xs text-muted-foreground"
          >{query.trim()}</span
        >
      </span>
      <ArrowRight
        class="size-3.5 flex-none text-muted-foreground group-hover:text-foreground"
        strokeWidth={2.2}
        aria-hidden="true"
      />
    </button>
  {:else if items.length || placeholderCount}
    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      <div
        class="grid grid-cols-1 gap-1.5 md:grid-cols-2"
        role="listbox"
        aria-label="Recent projects"
        tabindex={-1}
        aria-activedescendant={activeDescendant}
      >
        {#each items as item, i (item.key)}
          {@const current = item.key === activeProjectKey}
          {@const selected = selectedIndex === i}
          <ContextMenu items={projectMenu(item)} triggerClass="contents">
            <div
              id={`recent:${encodeURIComponent(item.key)}`}
              class={`group grid w-full cursor-pointer gap-2 rounded-md border px-2.5 py-2 text-left focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                selected
                  ? "border-primary/50 bg-accent/80"
                  : "border-border bg-accent/40 hover:bg-accent/70"
              }`}
              role="option"
              aria-selected={selected}
              tabindex="-1"
              onclick={() => onOpen(item)}
              onkeydown={(event) => onRowKeydown(event, i, item)}
            >
              <span class="grid min-w-0 gap-0.5">
                <span class="flex min-w-0 items-center gap-1.5">
                  <strong
                    class="min-w-0 truncate text-sm font-medium text-foreground"
                  >
                    {item.project.name}
                  </strong>
                  {#if current}
                    <Badge tone="accent" size="xs" class="flex-none"
                      >Current</Badge
                    >
                  {/if}
                </span>
                <span
                  class="min-w-0 truncate font-mono text-xs text-muted-foreground"
                >
                  {tildePath(item.project.dir, homeDir)}
                </span>
              </span>
              <ProjectCardStatus
                {item}
                git={gitByProjectKey[item.key]}
                gitLoading={gitLoadingByProjectKey[item.key] ?? false}
                gitError={gitErrorByProjectKey[item.key] ?? false}
              />
            </div>
          </ContextMenu>
        {/each}
        {#each Array.from(Array(placeholderCount).keys()) as i (i)}
          <div role="option" aria-selected="false" class="contents">
            <button
              type="button"
              class="group grid min-h-22 w-full place-content-center justify-items-center gap-1 rounded-md border border-dashed border-border bg-accent/20 px-2.5 py-2 text-center text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label="Browse for a project folder"
              onclick={onBrowse}
            >
              <FolderSearch
                class="size-4 text-muted-foreground group-hover:text-foreground"
                aria-hidden="true"
              />
              <span class="text-xs font-medium">Browse for a project</span>
            </button>
          </div>
        {/each}
      </div>
    </Tooltip.Provider>
  {:else}
    <div
      class="grid min-h-40 place-items-center gap-1 p-6 text-center text-muted-foreground"
    >
      <FolderOpen size={26} strokeWidth={1.8} aria-hidden="true" />
      <p class="m-0 mt-1 text-sm text-foreground">
        {totalRecentCount
          ? "No recent projects match your search."
          : "No recent projects yet."}
      </p>
      <span class="text-xs">Use Open above to open a project folder.</span>
    </div>
  {/if}
</div>
