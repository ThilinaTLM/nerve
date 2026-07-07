<script lang="ts">
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "@nervekit/ui/components/ui/button";
  import SandboxSummaryCards from "../SandboxSummaryCards.svelte";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { filteredSandboxes } from "../../state/sandbox-manager-selectors.svelte";

  const store = useSandboxManagerStore();
  const center = useSandboxCenter();
  const sandboxes = $derived(filteredSandboxes(store));
  const selected = $derived(center.selectedSandboxId);
</script>

<div class="h-full overflow-auto bg-background p-6">
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <SandboxSummaryCards />

    <section class="flex flex-col items-center gap-4 rounded-md border border-dashed bg-card px-6 py-10 text-center">
      <div class="rounded-md bg-muted p-3">
        <LayoutDashboard class="size-7 text-muted-foreground" />
      </div>
      <div class="max-w-md">
        <h2 class="text-lg font-semibold">No tabs open</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Open a sandbox summary from the navigator or start a new conversation.
          {#if sandboxes.length > 0}
            The fleet currently has {sandboxes.length} sandbox{sandboxes.length === 1 ? "" : "es"} in view.
          {/if}
        </p>
      </div>
      <div class="flex flex-wrap justify-center gap-2">
        {#if selected}
          <Button size="sm" variant="outline" onclick={() => store.openWorkspaceSummaryTab(selected)}>
            <LayoutDashboard class="size-4" /> Open selected summary
          </Button>
        {/if}
        <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
          <Plus class="size-4" /> New sandbox
        </Button>
      </div>
    </section>
  </div>
</div>
