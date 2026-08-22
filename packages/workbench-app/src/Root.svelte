<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import { ModeWatcher } from "mode-watcher";
import App from "./App.svelte";
import { Toaster } from "@nervekit/ui-kit/components/ui/sonner";
import { desktopRuntime } from "$lib/platform/desktop/desktop-bridge.svelte";
import { queryClient } from "$lib/platform/query/client";
</script>

<ModeWatcher />
<QueryClientProvider client={queryClient}>
  <App />
  {#if !desktopRuntime.isDesktop}
    <Toaster position="bottom-right" closeButton />
  {/if}
</QueryClientProvider>
