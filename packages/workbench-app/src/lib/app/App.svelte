<script lang="ts">
import WorkbenchHost from "$lib/app/shell/WorkbenchHost.svelte";
import WorkbenchProvider from "$lib/app/providers/WorkbenchProvider.svelte";
import { desktopRuntime } from "$lib/platform/desktop/desktop-bridge.svelte";

const documentTitle = $derived(
  desktopRuntime.developmentSlot
    ? `[DEV ${desktopRuntime.developmentSlot}] nerve`
    : "nerve",
);
</script>

<svelte:head>
  <title>{documentTitle}</title>
</svelte:head>

<WorkbenchProvider>
  <WorkbenchHost />
</WorkbenchProvider>
