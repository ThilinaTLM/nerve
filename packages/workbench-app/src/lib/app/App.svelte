<script lang="ts">
import WorkbenchHost from "$lib/app/shell/WorkbenchHost.svelte";
import WorkbenchProvider from "$lib/app/providers/WorkbenchProvider.svelte";
</script>

<svelte:head>
  <title>nerve</title>
</svelte:head>

<WorkbenchProvider>
  <WorkbenchHost />
</WorkbenchProvider>
