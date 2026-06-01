<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import App from "./App.svelte";
  import { queryClient } from "./lib/query";
</script>

<QueryClientProvider client={queryClient}>
  <App />
</QueryClientProvider>
