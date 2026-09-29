<script lang="ts">
import type { Snippet } from "svelte";

/**
 * One full-screen layer inside `MobileShell`. Hidden layers stay mounted so
 * scroll position and live conversation state survive navigation.
 */
let { hidden = false, children }: { hidden?: boolean; children: Snippet } =
  $props();
</script>

<div class="mobile-layer" {hidden}>
  {@render children()}
</div>

<style>
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
