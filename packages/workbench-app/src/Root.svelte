<script lang="ts">
import { QueryClientProvider } from "@tanstack/svelte-query";
import { colorThemeKind } from "@nervekit/contracts/settings";
import App from "./App.svelte";
import { Toaster } from "@nervekit/ui-kit/components/ui/sonner";
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import { desktopRuntime } from "$lib/platform/desktop/desktop-bridge.svelte";
import { queryClient } from "$lib/platform/query/client";
</script>

<QueryClientProvider client={queryClient}>
  <App />
  {#if !desktopRuntime.isDesktop}
    <Toaster
      position="bottom-right"
      closeButton
      theme={colorThemeKind[appearanceState.theme]}
    />
  {/if}
</QueryClientProvider>
