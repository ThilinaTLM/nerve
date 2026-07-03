<script lang="ts">
  import SandboxManagerProvider from "./SandboxManagerProvider.svelte";
  import SandboxManagerShell from "./routes/SandboxManagerShell.svelte";
</script>

<svelte:head>
  <title>nerve sandbox manager</title>
</svelte:head>

<SandboxManagerProvider>
  <SandboxManagerShell />
</SandboxManagerProvider>
