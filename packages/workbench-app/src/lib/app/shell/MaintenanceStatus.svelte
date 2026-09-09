<script lang="ts">
import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
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

<Popover
  size="lg"
  side="top"
  align="end"
  triggerClass={`${STATUS_BAR_CHIP_BUTTON} min-w-0`}
  ariaLabel={`${label}. Show progress`}
  triggerTitle={label}
>
  {#snippet trigger()}
    <span class="inline-flex min-w-0 items-center gap-1.5">
      <Spinner class="size-3" />
      <span class="max-w-40 truncate">{label}</span>
    </span>
  {/snippet}

  <PopoverHeader title="Maintenance" />
  <PopoverBody>
    <MaintenanceProgressView
      {operation}
      onCancel={() => void maintenance.cancel()}
    />
  </PopoverBody>
</Popover>
