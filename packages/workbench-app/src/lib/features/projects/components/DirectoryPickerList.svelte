<script lang="ts">
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import type { FilesystemEntry, NavItem, SignalMetaByKind } from "./directory-picker-types";

  type Props = {
    listEl?: HTMLDivElement;
    filteredEntries: FilesystemEntry[];
    loading: boolean;
    query: string;
    selectedIndex: number;
    selectedItem?: NavItem;
    activeDescendant?: string;
    signalMeta: SignalMetaByKind;
    isOpened: (path: string) => boolean;
    uniqueSignals: (signals: FilesystemEntry["signals"]) => FilesystemEntry["signals"];
    load: (path?: string) => void;
    onSelectedIndexChange?: (index: number) => void;
    onRowKeydown: (event: KeyboardEvent, index: number, item: NavItem) => void;
  };

  let {
    listEl = $bindable(),
    filteredEntries,
    loading,
    query,
    selectedIndex,
    selectedItem,
    activeDescendant,
    signalMeta,
    isOpened,
    uniqueSignals,
    load,
    onSelectedIndexChange,
    onRowKeydown,
  }: Props = $props();
</script>

<div class="picker-scroll" bind:this={listEl}>
  <section class="picker-group">
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
          {@const idx = fi}
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
