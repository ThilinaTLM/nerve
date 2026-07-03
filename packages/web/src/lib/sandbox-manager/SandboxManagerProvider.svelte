<script lang="ts">
  import { onDestroy, onMount, type Snippet } from "svelte";
  import {
    SandboxManagerStore,
    setSandboxManagerStore,
  } from "./state/sandbox-manager-state.svelte";

  let { children }: { children: Snippet } = $props();

  const store = new SandboxManagerStore();
  setSandboxManagerStore(store);

  onMount(() => {
    void store.init();
  });

  onDestroy(() => {
    store.dispose();
  });
</script>

{@render children()}
