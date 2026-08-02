<script lang="ts">
import type { Snippet } from "svelte";

let {
  desktop = false,
  left,
  actions,
}: {
  desktop?: boolean;
  left: Snippet;
  actions?: Snippet;
} = $props();
</script>

<!-- `-webkit-app-region: drag` makes the desktop titlebar the window drag
     handle (escape-hatch reason 7). -->
<header
  class={`flex h-full min-w-0 items-center justify-between gap-4 border-b border-border bg-card px-3 pt-[env(safe-area-inset-top)] select-none ${
    desktop ? "[-webkit-app-region:drag]" : ""
  }`}
>
  <div class="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
    {@render left()}
  </div>
  {#if actions}
    {@render actions()}
  {/if}
</header>
