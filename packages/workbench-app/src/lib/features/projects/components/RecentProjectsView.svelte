<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Copy from "@lucide/svelte/icons/copy";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import LayoutPanelLeft from "@lucide/svelte/icons/layout-panel-left";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ProjectRecord } from "$lib/api";
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
  lastAccessedFor?: (project: ProjectRecord) => number | undefined;
  isCurrent?: (project: ProjectRecord) => boolean;
  onOpen: (project: ProjectRecord) => void;
  onForget?: (projectId: string) => void;
  onCopyPath: (path: string) => void;
  onNewChat: (path: string) => void;
  onBrowsePath: () => void;
  onQueryChange?: () => void;
  onSubmit?: (event: Event) => void;
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
  lastAccessedFor,
  isCurrent,
  onOpen,
  onForget,
  onCopyPath,
  onNewChat,
  onBrowsePath,
  onQueryChange,
  onSubmit,
  onRowKeydown,
}: Props = $props();

function lastAccessLabel(timestamp: number | undefined): string {
  if (timestamp === undefined) return "—";
  return relativeTimeLabel(new Date(timestamp).toISOString());
}

function lastAccessTitle(timestamp: number | undefined): string {
  if (timestamp === undefined) return "Last access not recorded";
  return `Last accessed ${dateTimeLabel(new Date(timestamp).toISOString())}`;
}

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
  {:else if recentProjects.length}
    <div
      class="grid gap-px"
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
        {@const lastAccessedAt = lastAccessedFor?.(project)}
        {@const selected = selectedIndex === i}
        <ContextMenu items={projectMenu(project)} triggerClass="contents">
          <div
            id={`recent:${project.id}`}
            class={`group flex w-full cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
              selected
                ? "border-border bg-accent"
                : "border-transparent hover:bg-accent/60"
            }`}
            role="option"
            aria-selected={selected}
            tabindex="-1"
            title={`${project.dir}\n${lastAccessTitle(lastAccessedAt)}${indicator ? `\n${indicator.summary}` : ""}`}
            onclick={() => onOpen(project)}
            onkeydown={(e) => onRowKeydown(e, i, project)}
          >
            <span
              class={`grid size-7 flex-none place-items-center rounded-md border ${
                current
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : `border-border/60 bg-muted/40 ${
                      selected
                        ? "text-foreground"
                        : "text-muted-foreground group-hover:text-foreground"
                    }`
              }`}
              title={current ? "Current project" : undefined}
            >
              <LayoutPanelLeft class="size-3.5" aria-hidden="true" />
              {#if current}
                <span class="sr-only">Current project</span>
              {/if}
            </span>
            <span class="grid min-w-0 flex-1 gap-px">
              <span class="flex min-w-0 items-center gap-1.5">
                <strong
                  class="min-w-0 truncate text-sm font-normal text-foreground"
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
              </span>
              <span
                class="min-w-0 truncate font-mono text-xs text-muted-foreground"
                >{tildePath(project.dir, homeDir)}</span
              >
            </span>
            <span
              class="flex-none pl-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {chats} chat{chats === 1 ? "" : "s"}
              <span class="px-1 text-muted-foreground/50" aria-hidden="true"
                >·</span
              >
              {lastAccessedAt === undefined
                ? "Not accessed"
                : `Accessed ${lastAccessLabel(lastAccessedAt)}`}
            </span>
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
