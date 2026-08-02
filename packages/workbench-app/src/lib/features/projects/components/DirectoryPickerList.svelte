<script lang="ts">
import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type {
  FilesystemEntry,
  NavItem,
  SignalMetaByKind,
} from "./directory-picker-types";

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
  uniqueSignals: (
    signals: FilesystemEntry["signals"],
  ) => FilesystemEntry["signals"];
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

<div class="min-h-0 overflow-auto p-2" bind:this={listEl}>
  <section>
    <header
      class="flex items-center gap-2 px-1 pt-1 pb-1.5 font-mono text-xs tracking-wide text-muted-foreground uppercase"
    >
      <span>Folders</span>
      {#if !loading && filteredEntries.length}<span
          class="ml-auto text-muted-foreground tabular-nums"
          >{filteredEntries.length}</span
        >{/if}
    </header>

    {#if loading}
      <div class="grid gap-0.5" aria-label="Loading directories">
        {#each [0, 1, 2, 3, 4, 5, 6] as index (index)}<span class="skeleton-row"
          ></span>{/each}
      </div>
    {:else if filteredEntries.length}
      <div
        class="grid gap-0.5"
        role="listbox"
        aria-label="Folders"
        tabindex={-1}
        aria-activedescendant={selectedItem?.kind === "folder"
          ? activeDescendant
          : undefined}
      >
        {#each filteredEntries as entry, fi (entry.path)}
          {@const idx = fi}
          <div
            id={`folder:${entry.path}`}
            class="row"
            class:selected={selectedIndex === idx}
            role="option"
            aria-selected={selectedIndex === idx}
            tabindex="-1"
            title={entry.path}
            onclick={() => onSelectedIndexChange?.(idx)}
            ondblclick={() => void load(entry.path)}
            onkeydown={(e) =>
              onRowKeydown(e, idx, {
                kind: "folder",
                id: `folder:${entry.path}`,
                path: entry.path,
                entry,
              })}
          >
            <Folder
              size={15}
              strokeWidth={2.1}
              aria-hidden="true"
              class="flex-none text-muted-foreground"
            />
            <span class="grid min-w-0 gap-px"
              ><strong
                class="overflow-hidden text-sm font-medium text-ellipsis whitespace-nowrap"
                >{entry.name}</strong
              ></span
            >
            <span class="flex items-center justify-end gap-1.5">
              {#if isOpened(entry.path)}<Badge tone="good" size="xs"
                  ><CheckCircle2 size={11} />Opened</Badge
                >{/if}
              {#each uniqueSignals(entry.signals) as signal (signal)}
                {@const meta = signalMeta[signal]}
                {@const Icon = meta.icon}
                <Badge
                  tone={meta.tone ?? "neutral"}
                  size="xs"
                  title={meta.title}
                  ><Icon size={11} strokeWidth={2.2} />{meta.label}</Badge
                >
              {/each}
              <button
                class="row-drill"
                type="button"
                title="Open folder"
                aria-label="Open folder"
                onclick={(e) => {
                  e.stopPropagation();
                  void load(entry.path);
                }}
              >
                <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <div
        class="grid min-h-48 place-items-center gap-1 text-center text-muted-foreground"
      >
        <FolderOpen size={26} strokeWidth={1.8} />
        <p class="mt-1 text-sm text-foreground">
          {query.trim()
            ? "No folders match your filter."
            : "No subfolders here."}
        </p>
        <span class="font-mono text-xs"
          >{query.trim()
            ? "Clear the filter or paste a path."
            : "Use Open below to choose this folder as the project."}</span
        >
      </div>
    {/if}
  </section>
</div>

<style>
.row {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: 2.25rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  padding: 0.3rem 0.5rem;
  color: var(--foreground);
  text-align: left;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.row:hover,
.row:focus-visible,
.row.selected {
  border-color: var(--border);
  background: var(--accent);
  outline: none;
}

.row:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 28%, transparent);
}

/* Selected-row accent bar (escape-hatch reason 4). */
.row.selected::before {
  content: "";
  position: absolute;
  inset: 0.2rem auto 0.2rem 0;
  width: 2px;
  border-radius: 999px;
  background: var(--primary);
}

/* The drill affordance is revealed by the row's own hover/selection state. */
.row-drill {
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 0.15rem;
  color: var(--muted-foreground);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease,
    color 120ms ease;
}

.row-drill:hover {
  background: var(--accent);
  color: var(--foreground);
}

.row:hover .row-drill,
.row.selected .row-drill,
.row-drill:focus-visible {
  opacity: 1;
}

/* Loading placeholder binds the shared picker-sheen keyframe
 * (escape-hatch reason 1). */
.skeleton-row {
  height: 2.25rem;
  border-radius: var(--radius-md);
  background: linear-gradient(
    90deg,
    color-mix(in oklab, var(--muted) 45%, transparent),
    color-mix(in oklab, var(--accent) 65%, transparent),
    color-mix(in oklab, var(--muted) 45%, transparent)
  );
  background-size: 220% 100%;
  animation: picker-sheen 1.2s ease-in-out infinite;
}
</style>
