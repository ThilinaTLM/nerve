<script lang="ts">
  import { onDestroy, onMount, type Snippet } from "svelte";
  import {
    SandboxCenterState,
    setSandboxCenter,
  } from "../state/sandbox-center.svelte";
  import {
    SandboxManagerStore,
    setSandboxManagerStore,
  } from "../state/sandbox-manager-state.svelte";

  let { children }: { children: Snippet } = $props();

  const store = new SandboxManagerStore();
  setSandboxManagerStore(store);

  const center = new SandboxCenterState({
    onSelect: (id) => {
      void store.selectSandbox(id);
    },
  });
  setSandboxCenter(center);

  onMount(() => {
    void store.init().then(() => center.restore());
  });

  onDestroy(() => {
    store.dispose();
  });
</script>

{@render children()}
