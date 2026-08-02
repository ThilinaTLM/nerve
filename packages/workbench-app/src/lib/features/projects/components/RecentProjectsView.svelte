<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Copy from "@lucide/svelte/icons/copy";
import FolderClock from "@lucide/svelte/icons/folder-clock";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ProjectRecord } from "$lib/api";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import { dateTimeLabel, relativeTimeLabel } from "$lib/core/utils/time";
import { tildePath } from "$lib/core/utils/path";

type Props = {
  scrollEl?: HTMLDivElement;
  recentProjects: ProjectRecord[];
  totalRecentCount: number;
  query: string;
  pathQuery: boolean;
  selectedIndex: number;
  activeDescendant?: string;
  homeDir?: string;
  loading: boolean;
  conversationCountFor: (project: ProjectRecord) => number;
  onOpen: (project: ProjectRecord) => void;
  onForget?: (projectId: string) => void;
  onCopyPath: (path: string) => void;
  onNewChat: (path: string) => void;
  onBrowsePath: () => void;
  onQueryChange?: () => void;
  onSubmit?: (event: Event) => void;
  onSelectedIndexChange?: (index: number) => void;
  onRowKeydown: (
    event: KeyboardEvent,
    index: number,
    project: ProjectRecord,
  ) => void;
};

let {
  scrollEl = $bindable(),
  recentProjects,
  totalRecentCount,
  query = $bindable(),
  pathQuery,
  selectedIndex,
  activeDescendant,
  homeDir,
  loading,
  conversationCountFor,
  onOpen,
  onForget,
  onCopyPath,
  onNewChat,
  onBrowsePath,
  onQueryChange,
  onSubmit,
  onSelectedIndexChange,
  onRowKeydown,
}: Props = $props();

function cardMenu(project: ProjectRecord): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "New chat", icon: Plus, onSelect: () => onNewChat(project.dir) },
    { label: "Copy path", icon: Copy, onSelect: () => onCopyPath(project.dir) },
  ];
  if (onForget) {
    items.push(
      { type: "separator" },
      {
        label: "Forget project",
        icon: Trash2,
        destructive: true,
        onSelect: () => onForget?.(project.id),
      },
    );
  }
  return items;
}
</script>

<form
  class="grid items-center border-b border-b-border/60 px-3 py-2.5"
  onsubmit={onSubmit}
>
  <SearchInput
    bind:value={query}
    onValueChange={() => onQueryChange?.()}
    placeholder="Search recent projects or paste a path"
    disabled={loading}
    inputClass="font-mono"
    ariaLabel="Search recent projects or enter a path"
  />
</form>

<div class="min-h-0 overflow-auto p-2" bind:this={scrollEl}>
  <section>
    <header
      class="flex items-center gap-2 px-1 pt-1 pb-1.5 font-mono text-xs tracking-wide text-muted-foreground uppercase"
    >
      <span>Recent</span>
      {#if totalRecentCount}<span
          class="ml-auto text-muted-foreground tabular-nums"
          >{totalRecentCount}</span
        >{/if}
    </header>

    {#if pathQuery}
      <button class="recent-browse-hint" type="button" onclick={onBrowsePath}>
        <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>Browse <strong>{query.trim()}</strong></span>
      </button>
    {:else if recentProjects.length}
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-1.5"
        role="listbox"
        aria-label="Recent projects"
        tabindex={-1}
        aria-activedescendant={activeDescendant}
      >
        {#each recentProjects as project, i (project.id)}
          {@const chats = conversationCountFor(project)}
          <ContextMenu items={cardMenu(project)} triggerClass="contents">
            <div
              id={`recent:${project.id}`}
              class="recent-card"
              class:selected={selectedIndex === i}
              role="option"
              aria-selected={selectedIndex === i}
              tabindex="-1"
              title={`${project.dir}\n${dateTimeLabel(project.updatedAt)}`}
              onclick={() => onOpen(project)}
              onmouseenter={() => onSelectedIndexChange?.(i)}
              onkeydown={(e) => onRowKeydown(e, i, project)}
            >
              <span class="recent-card-icon" aria-hidden="true">
                <FolderClock size={18} strokeWidth={2.05} />
              </span>
              <div class="grid min-w-0 gap-px">
                <div>
                  <strong
                    class="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap"
                    >{project.name}</strong
                  >
                </div>
                <div
                  class="flex items-center gap-1 overflow-hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  <span>{chats} chat{chats === 1 ? "" : "s"}</span>
                  <span class="text-muted-foreground/55" aria-hidden="true"
                    >·</span
                  >
                  <span>{relativeTimeLabel(project.updatedAt)}</span>
                </div>
                <div
                  class="overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground/85"
                >
                  {tildePath(project.dir, homeDir)}
                </div>
              </div>
            </div>
          </ContextMenu>
        {/each}
      </div>
    {:else}
      <div
        class="grid min-h-40 place-items-center gap-1 text-center text-muted-foreground"
      >
        <FolderOpen size={26} strokeWidth={1.8} />
        <p class="mt-1 text-sm text-foreground">
          {totalRecentCount
            ? "No recent projects match your search."
            : "No recent projects yet."}
        </p>
        <span class="font-mono text-xs"
          >Use Browse folders below to open a project.</span
        >
      </div>
    {/if}
  </section>
</div>

<style>
.recent-card {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card);
  padding: 0.7rem 0.75rem;
  color: var(--foreground);
  text-align: left;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.recent-card-icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--primary) 14%, transparent);
  color: var(--primary);
  transition: background 120ms ease;
}

/* Opaque two-token mixes so the hovered card stays readable over the card
 * surface (escape-hatch reason 8). */
.recent-card:hover,
.recent-card:focus-visible,
.recent-card.selected {
  border-color: color-mix(in oklab, var(--primary) 45%, var(--border));
  background: color-mix(in oklab, var(--accent) 65%, var(--card));
  box-shadow: var(--shadow-sm);
  outline: none;
}

.recent-card:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 28%, transparent);
}

.recent-card:hover .recent-card-icon,
.recent-card:focus-visible .recent-card-icon,
.recent-card.selected .recent-card-icon {
  background: color-mix(in oklab, var(--primary) 22%, transparent);
}

.recent-browse-hint {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  padding: 0.55rem 0.65rem;
  color: var(--foreground);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.recent-browse-hint:hover,
.recent-browse-hint:focus-visible {
  border-color: var(--primary);
  background: var(--accent);
  outline: none;
}
</style>
