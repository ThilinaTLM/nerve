<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { Toaster } from "svelte-sonner";
  import App from "./App.svelte";
  import { queryClient } from "./lib/query";
</script>

<QueryClientProvider client={queryClient}>
  <App />
  <Toaster
    position="bottom-right"
    theme="system"
    closeButton
    toastOptions={{
      style: "background: var(--color-panel); color: var(--color-text); border: 1px solid var(--color-border); box-shadow: var(--shadow-popover); border-radius: var(--radius-md);",
      descriptionClass: "nerve-toast-description",
    }}
  />
</QueryClientProvider>
