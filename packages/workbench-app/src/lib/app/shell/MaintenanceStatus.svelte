<script lang="ts">
import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Popover from "@nervekit/ui-kit/components/ui/popover";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import MaintenanceProgressView from "$lib/presentation/maintenance/MaintenanceProgressView.svelte";
import { maintenance } from "$lib/application/maintenance/maintenance-state.svelte";
let { operation }: { operation: MaintenanceOperation } = $props();
const label = $derived(
  operation.totalItems === undefined
    ? "Cleanup in progress"
    : `Cleaning up ${operation.completedItems}/${operation.totalItems}`,
);
</script>
<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="xs"
        class="h-5 min-w-0 gap-1 px-1.5 text-xs"
        ariaLabel={`${label}. Show progress`}
        title={label}
      >
        <Spinner class="size-3" /><span class="max-w-40 truncate">{label}</span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content side="top" align="end" class="w-80 max-w-full p-3">
    <MaintenanceProgressView
      {operation}
      onCancel={() => void maintenance.cancel()}
    />
  </Popover.Content>
</Popover.Root>
