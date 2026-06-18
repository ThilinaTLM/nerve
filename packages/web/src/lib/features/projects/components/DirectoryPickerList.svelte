<script lang="ts">
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderClock from "@lucide/svelte/icons/folder-clock";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ProjectRecord } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { buttonVariants } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { dateTimeLabel, relativeTimeLabel } from "$lib/core/utils/time";
  import { tildePath } from "$lib/core/utils/path";
  import type { FilesystemEntry, NavItem, SignalMetaByKind } from "./directory-picker-types";

  type Props = {
    listEl?: HTMLDivElement;
    showRecent: boolean;
    recentProjects: ProjectRecord[];
    filteredEntries: FilesystemEntry[];
    loading: boolean;
    query: string;
    selectedIndex: number;
    selectedItem?: NavItem;
    activeDescendant?: string;
    recentCount: number;
    signalMeta: SignalMetaByKind;
    homeDir?: string;
    isOpened: (path: string) => boolean;
    conversationCountFor: (project: ProjectRecord) => number;
    uniqueSignals: (signals: FilesystemEntry["signals"]) => FilesystemEntry["signals"];
    load: (path?: string) => void;
    copyPath: (path: string) => void;
    onSelect?: (path: string) => void | Promise<void>;
    onForget?: (projectId: string) => void;
    onSelectedIndexChange?: (index: number) => void;
    onRowKeydown: (event: KeyboardEvent, index: number, item: NavItem) => void;
  };

  let {
    listEl = $bindable(),
    showRecent,
    recentProjects,
    filteredEntries,
    loading,
    query,
    selectedIndex,
    selectedItem,
    activeDescendant,
    recentCount,
    signalMeta,
    homeDir,
    isOpened,
    conversationCountFor,
    uniqueSignals,
    load,
    copyPath,
    onSelect,
    onForget,
    onSelectedIndexChange,
    onRowKeydown,
  }: Props = $props();
</script>

<div class="picker-scroll" bind:this={listEl}>
  {#if showRecent}
    <section class="group">
      <header class="group-head"><span>Recent</span></header>
      <div class="rows" role="listbox" aria-label="Recent projects" tabindex={-1} aria-activedescendant={selectedItem?.kind === "recent" ? activeDescendant : undefined}>
        {#each recentProjects as project, ri}
          {@const idx = ri}
          <div
            id={`recent:${project.id}`}
            class="row recent-row app-interactive-row"
            class:selected={selectedIndex === idx}
            role="option"
            aria-selected={selectedIndex === idx}
            tabindex="-1"
            title={`${project.dir}\n${dateTimeLabel(project.updatedAt)}`}
            onclick={() => onSelectedIndexChange?.(idx)}
            ondblclick={() => void onSelect?.(project.dir)}
            onkeydown={(e) => onRowKeydown(e, idx, { kind: "recent", id: `recent:${project.id}`, path: project.dir, project })}
          >
            <FolderClock size={16} strokeWidth={2.05} aria-hidden="true" />
            <span class="row-main">
              <span class="row-title">
                <strong>{project.name}</strong>
                <small class="row-sub">{conversationCountFor(project)} chats · {relativeTimeLabel(project.updatedAt)}</small>
              </span>
              <small class="row-path">{tildePath(project.dir, homeDir)}</small>
            </span>
            <span class="row-actions">
              <button class="row-open" type="button" title="Open project" onclick={(e) => { e.stopPropagation(); void onSelect?.(project.dir); }}>
                <FolderOpen size={13} strokeWidth={2.2} />Open
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "icon-xs" })} title="Project actions" aria-label="Project actions" onclick={(e: MouseEvent) => e.stopPropagation()}>
                  <MoreHorizontal size={15} strokeWidth={2} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-44">
                  <DropdownMenu.Item onSelect={() => void onSelect?.(project.dir)}><Plus /><span>New chat</span></DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void copyPath(project.dir)}><Copy /><span>Copy path</span></DropdownMenu.Item>
                  {#if onForget}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item variant="destructive" onSelect={() => onForget?.(project.id)}><Trash2 /><span>Forget project</span></DropdownMenu.Item>
                  {/if}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="group">
    <header class="group-head">
      <span>Folders</span>
      {#if !loading && filteredEntries.length}<span class="group-count">{filteredEntries.length}</span>{/if}
    </header>

    {#if loading}
      <div class="rows" aria-label="Loading directories">
        {#each Array.from({ length: 7 }) as _}<span class="skeleton-row"></span>{/each}
      </div>
    {:else if filteredEntries.length}
      <div class="rows" role="listbox" aria-label="Folders" tabindex={-1} aria-activedescendant={selectedItem?.kind === "folder" ? activeDescendant : undefined}>
        {#each filteredEntries as entry, fi}
          {@const idx = recentCount + fi}
          <div
            id={`folder:${entry.path}`}
            class="row folder-row app-interactive-row"
            class:selected={selectedIndex === idx}
            role="option"
            aria-selected={selectedIndex === idx}
            tabindex="-1"
            title={entry.path}
            onclick={() => onSelectedIndexChange?.(idx)}
            ondblclick={() => void load(entry.path)}
            onkeydown={(e) => onRowKeydown(e, idx, { kind: "folder", id: `folder:${entry.path}`, path: entry.path, entry })}
          >
            <Folder size={15} strokeWidth={2.1} aria-hidden="true" />
            <span class="row-main"><strong>{entry.name}</strong></span>
            <span class="row-badges">
              {#if isOpened(entry.path)}<Badge tone="good" size="xs"><CheckCircle2 size={11} />Opened</Badge>{/if}
              {#each uniqueSignals(entry.signals) as signal}
                {@const meta = signalMeta[signal]}
                {@const Icon = meta.icon}
                <Badge tone={meta.tone ?? "neutral"} size="xs" title={meta.title}><Icon size={11} strokeWidth={2.2} />{meta.label}</Badge>
              {/each}
              <button class="row-drill" type="button" title="Open folder" aria-label="Open folder" onclick={(e) => { e.stopPropagation(); void load(entry.path); }}>
                <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">
        <FolderOpen size={26} strokeWidth={1.8} />
        <p>{query.trim() ? "No folders match your filter." : "No subfolders here."}</p>
        <span>{query.trim() ? "Clear the filter or paste a path." : "Use Open below to choose this folder as the project."}</span>
      </div>
    {/if}
  </section>
</div>
