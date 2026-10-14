<script lang="ts">
import WorkbenchApp from "$lib/app/App.svelte";

// Keep the import itself behind Vite's compile-time development flag, rather
// than relying on Svelte's conditional rendering to remove the lab bundle.
const lab =
  import.meta.env.DEV && window.location.pathname.startsWith("/dev/")
    ? import("$lib/app/design-lab/DesignLab.svelte")
    : undefined;
</script>

{#if lab}
  {#await lab then { default: DesignLab }}
    <DesignLab />
  {/await}
{:else}
  <WorkbenchApp />
{/if}
