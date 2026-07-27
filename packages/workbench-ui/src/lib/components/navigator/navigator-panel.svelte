<script lang="ts">
import Search from "@lucide/svelte/icons/search";
import type { Snippet } from "svelte";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

let {
  searchValue = $bindable(""),
  placeholder = "Search",
  searchFocusToken = 0,
  searchAriaLabel,
  searchShortcut,
  searchShortcutAria,
  searchRef = $bindable(null),
  viewportRef = $bindable(null),
  searchActions,
  children,
}: {
  /** Two-way bound search query. */
  searchValue?: string;
  placeholder?: string;
  /** Increment to imperatively focus + select the search input. */
  searchFocusToken?: number;
  searchAriaLabel?: string;
  /** Human-readable shortcut label appended to the input title, e.g. "⌘K". */
  searchShortcut?: string;
  /** aria-keyshortcuts value for the search input. */
  searchShortcutAria?: string;
  searchRef?: HTMLInputElement | null;
  viewportRef?: HTMLElement | null;
  searchActions?: Snippet;
  children: Snippet;
} = $props();

let lastSearchFocusToken = 0;

const title = $derived(
  searchShortcut ? `${placeholder} (${searchShortcut})` : placeholder,
);

$effect(() => {
  if (searchFocusToken === lastSearchFocusToken) return;
  lastSearchFocusToken = searchFocusToken;
  searchRef?.focus();
  searchRef?.select();
});
</script>

<Tooltip.Provider delayDuration={300} disableHoverableContent>
  <aside class="navigator-panel">
    <div class="search-box">
      <div class="search-field">
        <Search size={13} strokeWidth={2.25} aria-hidden="true" />
        <Input
          bind:ref={searchRef}
          bind:value={searchValue}
          size="xs"
          {placeholder}
          ariaLabel={searchAriaLabel ?? placeholder}
          aria-keyshortcuts={searchShortcutAria}
          {title}
        />
      </div>
      {#if searchActions}
        <div class="search-actions">{@render searchActions()}</div>
      {/if}
    </div>

    <ScrollArea
      class="navigator-scroll"
      viewportClass="navigator-viewport"
      bind:viewportRef
      type="auto"
    >
      <div class="navigator-list">
        {@render children()}
      </div>
    </ScrollArea>
  </aside>
</Tooltip.Provider>

<style>
.navigator-panel {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border-right: 1px solid var(--border);
  background: var(--card);
}

.search-box {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  background: transparent;
}

.search-field {
  position: relative;
  min-width: 0;
  flex: 1;
}

.search-field :global(svg) {
  position: absolute;
  top: 50%;
  left: 0.85rem;
  z-index: 1;
  transform: translateY(-50%);
  color: var(--muted-foreground);
  pointer-events: none;
}

.search-field :global([data-slot="input"]) {
  padding-left: 1.75rem;
}

.search-actions {
  display: flex;
  flex: none;
  align-items: center;
}

:global(.navigator-scroll) {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
}

:global(.navigator-viewport) {
  width: 100%;
  min-width: 0;
  overflow-x: hidden;
  padding: 0.45rem;
}

.navigator-list {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
