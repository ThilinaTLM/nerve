<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ProjectRecord } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import { dateTimeLabel, relativeTimeLabel } from "$lib/core/utils/time";
import { tildePath } from "$lib/core/utils/path";
import {
  projectActivityIndicator,
  type ProjectActivitySummary,
} from "$lib/features/projects/state/project-switcher";

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
  activityFor?: (project: ProjectRecord) => ProjectActivitySummary | undefined;
  isCurrent?: (project: ProjectRecord) => boolean;
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
  activityFor,
  isCurrent,
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

function projectMenu(project: ProjectRecord): ContextMenuItem[] {
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
  {#if pathQuery}
    <button
      type="button"
      class="group flex w-full items-center gap-2 rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      onclick={onBrowsePath}
    >
      <span class="flex-none text-sm font-medium text-foreground">Browse</span>
      <span
        class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        >{query.trim()}</span
      >
      <ArrowRight
        class="size-3.5 flex-none text-muted-foreground transition-colors group-hover:text-foreground"
        strokeWidth={2.2}
        aria-hidden="true"
      />
    </button>
  {:else if recentProjects.length}
    <div
      class="grid gap-0.5"
      role="listbox"
      aria-label="Recent projects"
      tabindex={-1}
      aria-activedescendant={activeDescendant}
    >
      {#each recentProjects as project, i (project.id)}
        {@const chats = conversationCountFor(project)}
        {@const summary = activityFor?.(project)}
        {@const indicator = summary
          ? projectActivityIndicator(summary)
          : undefined}
        {@const current = isCurrent?.(project) ?? false}
        {@const selected = selectedIndex === i}
        <ContextMenu items={projectMenu(project)} triggerClass="contents">
          <div
            id={`recent:${project.id}`}
            class={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
              selected
                ? "border-primary/40 bg-primary/10"
                : "border-transparent hover:bg-accent"
            }`}
            role="option"
            aria-selected={selected}
            tabindex="-1"
            title={`${project.dir}\n${dateTimeLabel(project.updatedAt)}${indicator ? `\n${indicator.summary}` : ""}`}
            onclick={() => onOpen(project)}
            onmouseenter={() => onSelectedIndexChange?.(i)}
            onkeydown={(e) => onRowKeydown(e, i, project)}
          >
            <strong
              class="max-w-2/5 flex-none truncate text-sm font-medium text-foreground"
              >{project.name}</strong
            >
            {#if indicator}
              <StatusDot
                tone={indicator.tone}
                size="xs"
                pulse={indicator.pulse}
                label={indicator.summary}
              />
            {/if}
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              >{tildePath(project.dir, homeDir)}</span
            >
            {#if current}
              <Badge tone="good" size="xs" class="flex-none">Current</Badge>
            {/if}
            <span
              class="flex-none text-xs whitespace-nowrap text-muted-foreground tabular-nums"
              >{chats} chat{chats === 1 ? "" : "s"} · {relativeTimeLabel(
                project.updatedAt,
              )}</span
            >
          </div>
        </ContextMenu>
      {/each}
    </div>
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
      <span class="text-xs">Use Browse below to open a project folder.</span>
    </div>
  {/if}
</div>
