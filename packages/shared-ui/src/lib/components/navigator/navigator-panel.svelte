<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import type { Snippet } from "svelte";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import { ScrollArea } from "@nervekit/shared-ui/components/ui/scroll-area";
  import * as Tooltip from "@nervekit/shared-ui/components/ui/tooltip";

  let {
    searchValue = $bindable(""),
    placeholder = "Search",
    searchFocusToken = 0,
    searchAriaLabel,
    searchShortcut,
    searchShortcutAria,
    searchRef = $bindable(null),
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
      <Search size={13} strokeWidth={2.25} aria-hidden="true" />
      <Input
        bind:ref={searchRef}
        bind:value={searchValue}
        size="sm"
        {placeholder}
        ariaLabel={searchAriaLabel ?? placeholder}
        aria-keyshortcuts={searchShortcutAria}
        {title}
      />
    </div>

    <ScrollArea class="navigator-scroll" viewportClass="navigator-viewport" type="auto">
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
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    align-items: center;
    padding: 0.45rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    background: transparent;
  }

  .search-box :global(svg) {
    position: absolute;
    left: 0.85rem;
    z-index: 1;
    color: var(--muted-foreground);
    pointer-events: none;
  }

  .search-box :global([data-slot="input"]) {
    padding-left: 1.75rem;
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
