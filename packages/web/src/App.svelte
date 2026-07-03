<script lang="ts">
  import WorkbenchApp from "$lib/app/App.svelte";
  import { isSandboxManagerSurface } from "$lib/sandbox-manager/surface";

  const sandboxManager = isSandboxManagerSurface();
</script>

{#if sandboxManager}
  {#await import("$lib/sandbox-manager/SandboxManagerApp.svelte") then module}
    {@const SandboxManagerApp = module.default}
    <SandboxManagerApp />
  {/await}
{:else}
  <WorkbenchApp />
{/if}
