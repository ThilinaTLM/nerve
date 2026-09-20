<script lang="ts">
import type { Snippet } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import MobileTabBar, { type MobileTabModel } from "./MobileTabBar.svelte";
import type { MobileTabId } from "./mobile-navigation.js";

/**
 * The phone shell. Root screens sit behind a tab bar in the thumb zone; detail
 * screens cover the whole viewport so transcripts and the composer get every
 * pixel. The center layer stays mounted for the lifetime of the shell because
 * it holds live conversation state.
 */
let {
  tabs,
  activeTab,
  onSelectTab,
  centerVisible = false,
  panelVisible = false,
  projectsVisible = false,
  root,
  center,
  panel,
  projects,
  overlays,
}: {
  tabs: readonly MobileTabModel[];
  activeTab: MobileTabId;
  onSelectTab: (tab: MobileTabId) => void;
  centerVisible?: boolean;
  panelVisible?: boolean;
  projectsVisible?: boolean;
  root: Snippet<[MobileTabId]>;
  center: Snippet;
  panel?: Snippet;
  /** Project picker page, layered like any other detail screen. */
  projects?: Snippet;
  overlays?: Snippet;
} = $props();

// Root screens mount on first visit and stay mounted, so returning to a tab
// keeps its scroll position and any in-flight panel state.
const visited = new SvelteSet<MobileTabId>();
$effect(() => {
  visited.add(activeTab);
});

const detailVisible = $derived(
  centerVisible || panelVisible || projectsVisible,
);
</script>

<main class="mobile-frame">
  <div class="mobile-stack">
    {#each tabs as tab (tab.id)}
      {#if visited.has(tab.id)}
        <div
          class="mobile-layer"
          hidden={detailVisible || tab.id !== activeTab}
        >
          {@render root(tab.id)}
        </div>
      {/if}
    {/each}

    <div class="mobile-layer" hidden={!centerVisible}>{@render center()}</div>

    {#if panel}
      <div class="mobile-layer" hidden={!panelVisible}>{@render panel()}</div>
    {/if}

    {#if projects && projectsVisible}
      <div class="mobile-layer">{@render projects()}</div>
    {/if}
  </div>

  {#if !detailVisible}
    <MobileTabBar {tabs} {activeTab} onSelect={onSelectTab} />
  {/if}

  {#if overlays}{@render overlays()}{/if}
</main>

<style>
.mobile-frame {
  position: relative;
  display: grid;
  width: 100%;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
  background: var(--background);
  color: var(--foreground);
}

@supports (height: 100dvh) {
  .mobile-frame {
    height: 100dvh;
  }
}

/* Every layer shares one grid cell; `hidden` is what selects the visible one,
 * so nothing unmounts when the reader moves between tabs. */
.mobile-stack {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-areas: "layer";
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.mobile-layer {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-area: layer;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.mobile-layer[hidden] {
  display: none;
}
</style>
