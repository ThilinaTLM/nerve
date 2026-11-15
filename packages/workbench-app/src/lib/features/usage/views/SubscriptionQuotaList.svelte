<script lang="ts">
import type { SubscriptionUsage } from "$lib/api";
import {
  PopoverMeter,
  PopoverProperties,
  PopoverProperty,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import {
  consumptionQuotas,
  consumptionValue,
  meterTone,
  meterValue,
  quotaCaption,
  quotaMeters,
  unlimitedSummary,
} from "../usage-display";

/** One provider's quotas: meters, uncapped consumption, then unlimited items. */
let { usage }: { usage?: SubscriptionUsage | null } = $props();

const meters = $derived(quotaMeters(usage));
const consumption = $derived(consumptionQuotas(usage));
const unlimited = $derived(unlimitedSummary(usage));
</script>

{#each meters as item (item.quota.id)}
  <PopoverMeter
    label={item.label}
    value={meterValue(item.quota)}
    percent={item.quota.usedPercent ?? undefined}
    tone={meterTone(item.quota)}
    caption={quotaCaption(item.quota)}
  />
{/each}
{#each consumption as quota (quota.id)}
  <PopoverProperties>
    <PopoverProperty
      label={quota.label}
      value={consumptionValue(quota)}
      valueClass={quota.exhausted ? "text-destructive" : undefined}
    />
  </PopoverProperties>
  <span class="px-1.5 text-muted-foreground">{quotaCaption(quota)}</span>
{/each}
{#if unlimited}
  <span class="px-1.5 text-muted-foreground">{unlimited}</span>
{/if}
{#if meters.length === 0 && consumption.length === 0 && !unlimited}
  <span class="px-1.5 text-muted-foreground">No data</span>
{/if}
