<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Copy from "@lucide/svelte/icons/copy";
  import FolderClock from "@lucide/svelte/icons/folder-clock";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ProjectRecord } from "$lib/api";
  import ContextMenu, { type ContextMenuItem } from "@nervekit/shared-ui/components/ui/context-menu-list";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
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
    onOpen: (path: string) => void;
    onForget?: (projectId: string) => void;
    onCopyPath: (path: string) => void;
    onNewChat: (path: string) => void;
    onBrowsePath: () => void;
    onQueryChange?: () => void;
    onSubmit?: (event: Event) => void;
    onSelectedIndexChange?: (index: number) => void;
    onRowKeydown: (event: KeyboardEvent, index: number, project: ProjectRecord) => void;
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

<form class="picker-search" onsubmit={onSubmit}>
  <Search size={14} strokeWidth={2.2} aria-hidden="true" />
  <Input
    bind:value={query}
    oninput={() => onQueryChange?.()}
    placeholder="Search recent projects or paste a path"
    disabled={loading}
    size="sm"
    ariaLabel="Search recent projects or enter a path"
  />
</form>

<div class="picker-scroll recent-scroll" bind:this={scrollEl}>
  <section class="picker-group">
    <header class="group-head">
      <span>Recent</span>
      {#if totalRecentCount}<span class="group-count">{totalRecentCount}</span>{/if}
    </header>

    {#if pathQuery}
      <button class="recent-browse-hint" type="button" onclick={onBrowsePath}>
        <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>Browse <strong>{query.trim()}</strong></span>
      </button>
    {:else if recentProjects.length}
      <div class="recent-grid" role="listbox" aria-label="Recent projects" tabindex={-1} aria-activedescendant={activeDescendant}>
        {#each recentProjects as project, i}
          {@const chats = conversationCountFor(project)}
          <ContextMenu items={cardMenu(project)} triggerClass="recent-card-trigger">
            <div
              id={`recent:${project.id}`}
              class="recent-card app-interactive-row"
              class:selected={selectedIndex === i}
              role="option"
              aria-selected={selectedIndex === i}
              tabindex="-1"
              title={`${project.dir}\n${dateTimeLabel(project.updatedAt)}`}
              onclick={() => onOpen(project.dir)}
              onmouseenter={() => onSelectedIndexChange?.(i)}
              onkeydown={(e) => onRowKeydown(e, i, project)}
            >
              <span class="recent-card-icon" aria-hidden="true">
                <FolderClock size={18} strokeWidth={2.05} />
              </span>
              <div class="recent-card-body">
                <div class="recent-card-title"><strong>{project.name}</strong></div>
                <div class="recent-card-meta">
                  <span>{chats} chat{chats === 1 ? "" : "s"}</span>
                  <span class="recent-card-dot" aria-hidden="true">·</span>
                  <span>{relativeTimeLabel(project.updatedAt)}</span>
                </div>
                <div class="recent-card-path">{tildePath(project.dir, homeDir)}</div>
              </div>
            </div>
          </ContextMenu>
        {/each}
      </div>
    {:else}
      <div class="recent-empty">
        <FolderOpen size={26} strokeWidth={1.8} />
        <p>{totalRecentCount ? "No recent projects match your search." : "No recent projects yet."}</p>
        <span>Use Browse folders below to open a project.</span>
      </div>
    {/if}
  </section>
</div>
