<script lang="ts">
import { AccessGateHost } from "$lib/features/access";
import {
  hideStartupSplash,
  showStartupSplash,
} from "$lib/app/shell/startup-splash";
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

<!-- The index.html splash covers the page until the workbench reveals itself,
     so the pairing and login screens hide it and the app brings it back. -->
<AccessGateHost
  onGateVisibleChange={(visible) =>
    visible ? hideStartupSplash() : showStartupSplash()}
>
  <WorkbenchProvider>
    <WorkbenchHost />
  </WorkbenchProvider>
</AccessGateHost>
