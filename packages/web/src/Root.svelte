<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { ModeWatcher } from "mode-watcher";
  import App from "./App.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import { desktopRuntime } from "$lib/features/desktop/state/desktop-bridge.svelte";
  import { queryClient } from "./lib/query";
</script>

<ModeWatcher />
<QueryClientProvider client={queryClient}>
  <App />
  {#if !desktopRuntime.isDesktop}
    <Toaster position="bottom-right" closeButton />
  {/if}
</QueryClientProvider>
