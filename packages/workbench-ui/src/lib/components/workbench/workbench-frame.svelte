<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    titlebar,
    workspace,
    footer,
  }: {
    titlebar: Snippet;
    workspace: Snippet;
    footer: Snippet;
  } = $props();
</script>

<main class="app-frame">
  {@render titlebar()}
  {@render workspace()}
  {@render footer()}
</main>
