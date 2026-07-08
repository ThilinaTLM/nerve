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

<header class="titlebar" class:desktop>
  <div class="title-left">
    {@render left()}
  </div>
  {#if actions}
    {@render actions()}
  {/if}
</header>
