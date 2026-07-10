<script lang="ts">
  import AppLayout from "$lib/app/layout/AppLayout.svelte";
  import WorkbenchProvider from "$lib/app/providers/WorkbenchProvider.svelte";
</script>

<svelte:head>
  <title>nerve</title>
</svelte:head>

<WorkbenchProvider>
  <AppLayout />
</WorkbenchProvider>
