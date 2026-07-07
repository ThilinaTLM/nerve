<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import DialogShell from "@nervekit/ui/components/ui/dialog-shell";
  import SwitchField from "@nervekit/ui/components/ui/switch-field";
  import { useSandboxCenter } from "../state/sandbox-center.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let {
    open = $bindable(false),
    record,
  }: { open?: boolean; record: ManagedSandboxRecord } = $props();

  const center = useSandboxCenter();
  const store = useSandboxManagerStore();
  let force = $state(false);
  let removeVolumes = $state(false);
  let busy = $state(false);

  const dangerous = $derived(force || removeVolumes);

  async function confirm() {
    busy = true;
    try {
      await store.removeSandbox(record.sandboxId, { force, removeVolumes });
      if (center.selectedSandboxId === record.sandboxId) center.clearSelection();
      open = false;
      force = false;
      removeVolumes = false;
    } catch {
      // Error surfaced via pending operations.
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell
  bind:open
  title="Remove sandbox"
  description={`Remove ${record.name ?? record.sandboxId}. This action cannot be undone.`}
>
  <div class="flex flex-col gap-3 p-5">
    <SwitchField
      checked={force}
      label="Force remove"
      description="Force removal even if the container is still running."
      onCheckedChange={(value) => (force = value)}
    />
    <SwitchField
      checked={removeVolumes}
      label="Remove volumes"
      description="Delete the workspace and state volumes permanently."
      onCheckedChange={(value) => (removeVolumes = value)}
    />
    {#if dangerous}
      <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        <TriangleAlert class="mt-0.5 size-4 flex-none" />
        This will permanently delete resources for this sandbox.
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={busy} onclick={() => (open = false)}>
      Cancel
    </Button>
    <Button variant="destructive" size="sm" disabled={busy} onclick={confirm}>
      Remove sandbox
    </Button>
  {/snippet}
</DialogShell>
