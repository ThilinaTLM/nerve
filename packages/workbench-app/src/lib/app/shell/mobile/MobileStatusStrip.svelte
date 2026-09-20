<script lang="ts">
import { conversationSelectors } from "$lib/features/conversations";
import { SubscriptionUsageChip } from "$lib/features/usage";
import { usageSelectors } from "$lib/application/usage/usage-selectors.svelte";
import { maintenance, workspaceSelectors } from "$lib/application/workspace";
import MaintenanceStatus from "$lib/app/shell/MaintenanceStatus.svelte";
import StatusPopover from "$lib/app/shell/StatusPopover.svelte";

/**
 * The away-from-desk health line. Deliberately workspace-wide: connection and
 * quota apply everywhere, while repository state belongs to one project and
 * lives on the Workspace tab.
 */
const status = $derived(workspaceSelectors.status);
</script>

<div class="flex flex-wrap items-center gap-1.5 px-3 pb-1 pt-2">
  <StatusPopover
    connection={workspaceSelectors.connection}
    live={conversationSelectors.live}
    {status}
    side="bottom"
  />
  <SubscriptionUsageChip usages={usageSelectors.subscriptionUsages} />
  {#if maintenance.active && maintenance.operation}
    <MaintenanceStatus operation={maintenance.operation} />
  {/if}
</div>
