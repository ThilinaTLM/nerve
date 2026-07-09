<script lang="ts">
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import SandboxSummaryCards from "../SandboxSummaryCards.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { filteredSandboxes } from "../../state/sandbox-manager-selectors.svelte";

  const store = useSandboxManagerStore();
  const sandboxes = $derived(filteredSandboxes(store));
</script>

<div class="flex h-full min-h-0 overflow-auto bg-background p-4">
  <div class="m-auto flex w-full max-w-3xl flex-col gap-3">
    <SandboxSummaryCards />

    <section class="flex flex-col items-center gap-3 rounded-md border border-dashed bg-card px-6 py-8 text-center">
      <div class="rounded-md bg-muted p-2">
        <LayoutDashboard class="size-5 text-muted-foreground" />
      </div>
      <div class="max-w-md">
        <h2 class="text-sm font-semibold">No tabs open</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Open a sandbox from the navigator or create a new sandbox.
          {#if sandboxes.length > 0}
            The fleet currently has {sandboxes.length} sandbox{sandboxes.length === 1 ? "" : "es"} in view.
          {/if}
        </p>
      </div>
      <div class="flex flex-wrap justify-center gap-2">
        <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
          <Plus class="size-4" /> New sandbox
        </Button>
      </div>
    </section>
  </div>
</div>
