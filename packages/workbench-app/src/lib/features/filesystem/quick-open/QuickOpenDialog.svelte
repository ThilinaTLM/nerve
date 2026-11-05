<script lang="ts">
import FileSearch from "@lucide/svelte/icons/file-search";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { createListNavigation } from "@nervekit/ui-kit/components/composites/popover-panel";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import { MaterialFileIcon } from "$lib/presentation/files";
import { quickOpenPathParts } from "./quick-open-query";

export type QuickOpenItem = {
  path: string;
  positions: readonly number[];
};

let {
  open = $bindable(false),
  query,
  items,
  line,
  recent,
  loading = false,
  indexing = false,
  error,
  hasProject = true,
  onQueryChange,
  onChoose,
  onOpenChange,
}: {
  open?: boolean;
  query: string;
  items: QuickOpenItem[];
  /** Line parsed from a `path:line` suffix. */
  line?: number;
  /** Rows are recent files because nothing has been typed. */
  recent: boolean;
  loading?: boolean;
  /** The server index is still building, so results may be partial. */
  indexing?: boolean;
  error?: string;
  hasProject?: boolean;
  onQueryChange: (query: string) => void;
  onChoose: (item: QuickOpenItem, options: { reveal: boolean }) => void;
  onOpenChange: (open: boolean) => void;
} = $props();

const id = $props.id();
let viewport = $state<HTMLDivElement>();
let input = $state<HTMLInputElement | null>(null);
const rowId = (item: QuickOpenItem) => `${id}-${encodeURIComponent(item.path)}`;
const navigation = createListNavigation({
  items: () => items,
  getId: rowId,
  viewport: () => viewport,
  onChoose: (item) => onChoose(item, { reveal: false }),
});

$effect(() => {
  void items;
  navigation.reset();
});

function keydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    const item = items[navigation.index >= 0 ? navigation.index : 0];
    if (item) onChoose(item, { reveal: event.altKey });
    return;
  }
  navigation.handleKeydown(event);
}
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content
    showCloseButton={false}
    layout="shell"
    class="top-[20%] max-w-[calc(100%-2rem)] -translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      input?.focus();
    }}
  >
    <Dialog.Title class="sr-only">Quick open</Dialog.Title>
    <Dialog.Description class="sr-only">
      Search project files by name. Use arrow keys to move, Enter to open.
    </Dialog.Description>
    <div class="border-b border-border-subtle p-2">
      <SearchInput
        value={query}
        bind:ref={input}
        placeholder="Go to file (add :line to jump)"
        ariaLabel="Quick open"
        icon={FileSearch}
        controls={id}
        activeDescendant={navigation.activeDescendant}
        onValueChange={onQueryChange}
        onkeydown={keydown}
      >
        {#snippet trailing()}
          {#if loading}<Spinner class="size-3.5 text-muted-foreground" />{/if}
        {/snippet}
      </SearchInput>
    </div>

    <div
      bind:this={viewport}
      {id}
      role="listbox"
      aria-label={recent ? "Recent files" : "Matching files"}
      class="max-h-80 min-h-24 overflow-y-auto p-1"
    >
      {#if recent && items.length > 0}
        <div class="px-2 py-1 text-caption text-muted-foreground">
          Recent files
        </div>
      {/if}
      {#each items as item (item.path)}
        {@const parts = quickOpenPathParts(item.path, item.positions)}
        {@const active = navigation.activeDescendant === rowId(item)}
        <!-- Keyboard use goes through the search field (aria-activedescendant). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id={rowId(item)}
          role="option"
          tabindex="-1"
          aria-selected={active}
          class={cn(
            "flex h-control min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-ui hover:bg-hover",
            active && "bg-selected hover:bg-selected",
          )}
          onclick={(event) => onChoose(item, { reveal: event.altKey })}
        >
          <MaterialFileIcon name={parts.name} kind="file" />
          <span class="shrink-0 text-foreground">
            {#each parts.nameSegments as segment, index (index)}
              <span class={segment.match ? "font-medium text-primary" : ""}
                >{segment.text}</span
              >
            {/each}
          </span>
          {#if parts.directory}
            <span class="min-w-0 truncate text-muted-foreground">
              <span
                >{#each parts.directorySegments as segment, index (index)}<span
                    class={segment.match ? "font-medium text-primary" : ""}
                    >{segment.text}</span
                  >{/each}</span
              >
            </span>
          {/if}
          {#if line}
            <span class="ml-auto shrink-0 text-caption text-muted-foreground"
              >:{line}</span
            >
          {/if}
        </div>
      {:else}
        <div class="px-3 py-6 text-center text-ui text-muted-foreground">
          {#if !hasProject}
            Select a project to search its files.
          {:else if error}
            <span class="text-destructive">{error}</span>
          {:else if loading}
            Searching…
          {:else if indexing}
            Indexing…
          {:else if recent}
            No recent files. Type to search.
          {:else}
            No files match “{query}”.
          {/if}
        </div>
      {/each}
    </div>

    <div
      class="flex items-center gap-3 border-t border-border-subtle px-3 py-1.5 text-caption text-muted-foreground"
    >
      <span class="inline-flex items-center gap-1"><Kbd>↵</Kbd> Open</span>
      <span class="inline-flex items-center gap-1"
        ><Kbd>Alt ↵</Kbd> Reveal in Files</span
      >
      {#if indexing && items.length > 0}
        <span class="ml-auto inline-flex items-center gap-1.5"
          ><Spinner class="size-3" /> Indexing…</span
        >
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
