<script lang="ts">
import type { Snippet } from "svelte";
import MobileTabBar, { type MobileTabModel } from "./MobileTabBar.svelte";

/**
 * The phone shell frame: a stack of full-screen layers above a tab bar in the
 * thumb zone. Which layers exist and which one is visible is the host's call;
 * layers render through `MobileLayer` so they share one grid cell and keep
 * their state while hidden.
 */
let {
  tabs,
  activeTab,
  onSelectTab,
  tabBarVisible = true,
  children,
  overlays,
}: {
  tabs: readonly MobileTabModel[];
  activeTab: string;
  onSelectTab: (tab: string) => void;
  /** Detail screens hide the bar so transcripts and the composer get every pixel. */
  tabBarVisible?: boolean;
  children: Snippet;
  overlays?: Snippet;
} = $props();
</script>

<main class="mobile-frame">
  <div class="mobile-stack">
    {@render children()}
  </div>

  {#if tabBarVisible}
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

/* Every layer shares one grid cell; `hidden` selects the visible one, so
 * nothing unmounts when the reader moves between tabs or back through a stack. */
.mobile-stack {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-areas: "layer";
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}
</style>
