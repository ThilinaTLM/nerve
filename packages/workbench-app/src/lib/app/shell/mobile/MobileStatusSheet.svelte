<script lang="ts">
import {
  PopoverBody,
  PopoverHeader,
  PopoverProperties,
  PopoverProperty,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import { formatDurationMinutes } from "@nervekit/ui-kit/display/usage";
import {
  SubscriptionQuotaList,
  subscriptionProviderLabel,
} from "$lib/features/usage";
import { usageSelectors } from "$lib/application/usage/usage-selectors.svelte";
import { maintenance, workspaceSelectors } from "$lib/application/workspace";
import MaintenanceStatus from "$lib/app/shell/MaintenanceStatus.svelte";
import {
  mobileConnectionText,
  mobileStatusSheet,
} from "./mobile-status.svelte";

/**
 * Daemon and provider-usage details, opened from the root headers or the
 * status banner. Mounted once for the whole phone shell.
 */
const status = $derived(workspaceSelectors.status);
const usages = $derived(usageSelectors.subscriptionUsages);

const version = $derived(status?.version ? `v${status.version}` : undefined);
const uptime = $derived.by(() => {
  if (!status?.startedAt) return undefined;
  const started = new Date(status.startedAt).getTime();
  if (Number.isNaN(started)) return undefined;
  return formatDurationMinutes((Date.now() - started) / 60_000);
});
</script>

<Sheet.Root
  open={mobileStatusSheet.open}
  onOpenChange={(open) => (mobileStatusSheet.open = open)}
>
  <Sheet.Content
    side="bottom"
    class="rounded-t-lg pb-[max(0.5rem,var(--safe-bottom))]"
    swipeToDismiss
    onSwipeDismiss={() => (mobileStatusSheet.open = false)}
  >
    <Sheet.Title class="sr-only">Daemon status and usage</Sheet.Title>
    <div class="max-h-[70dvh] overflow-y-auto pb-2 text-ui">
      <PopoverHeader title="Nerve daemon" meta={version} />
      <PopoverBody>
        <PopoverProperties>
          <PopoverProperty label="Connection" value={mobileConnectionText()} />
          <PopoverProperty label="Uptime" value={uptime ?? undefined} />
          <PopoverProperty
            label="Index"
            value={status == null
              ? undefined
              : status.storage.indexHealthy
                ? "Healthy"
                : "Rebuilding"}
            valueClass={status?.storage.indexHealthy
              ? "text-success"
              : "text-warning"}
          />
        </PopoverProperties>
      </PopoverBody>
      {#each usages as entry (entry.provider)}
        <PopoverHeader
          title={`${subscriptionProviderLabel(entry.provider)} usage`}
        />
        <PopoverBody>
          <SubscriptionQuotaList usage={entry.usage} />
        </PopoverBody>
      {/each}
      {#if maintenance.active && maintenance.operation}
        <div class="px-3 pt-2">
          <MaintenanceStatus
            operation={maintenance.operation}
            onCancel={() => void maintenance.cancel()}
          />
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
