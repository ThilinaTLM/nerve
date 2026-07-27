<script lang="ts">
import WorkbenchShellContainer from "$lib/app/shell/WorkbenchShellContainer.svelte";
import WorkbenchProvider from "$lib/app/providers/WorkbenchProvider.svelte";
</script>

<svelte:head>
  <title>nerve</title>
</svelte:head>

<WorkbenchProvider>
  <WorkbenchShellContainer />
</WorkbenchProvider>
