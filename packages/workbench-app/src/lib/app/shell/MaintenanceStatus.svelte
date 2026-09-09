<script lang="ts">
import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Popover from "@nervekit/ui-kit/components/ui/popover";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import MaintenanceProgressView from "$lib/presentation/maintenance/MaintenanceProgressView.svelte";
import { maintenance } from "$lib/application/maintenance/maintenance-state.svelte";
import { STATUS_BAR_CHIP_BUTTON } from "$lib/presentation/shell";
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
        class={`${STATUS_BAR_CHIP_BUTTON} min-w-0`}
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
