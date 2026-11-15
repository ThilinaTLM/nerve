<script lang="ts">
import type { SubscriptionQuota } from "$lib/api";
import type { SubscriptionUsageEntry } from "$lib/features/usage/usage-types";
import { selectUsageTriggerEntry } from "./usage-trigger-selection";
import SubscriptionQuotaList from "./SubscriptionQuotaList.svelte";
import {
  consumptionChipValue,
  consumptionQuotas,
  consumptionValue,
  meterTone,
  percentLabel,
  quotaMeters,
  quotaResetShort,
  subscriptionProviderLabel,
  type DisplayMeter,
  type MeterTone,
} from "../usage-display";
import { cn } from "@nervekit/ui-kit/utils";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { STATUS_BAR_CHIP_BUTTON } from "$lib/presentation/shell";

type Props = {
  usages?: SubscriptionUsageEntry[];
  /** Phone widths: show only the most-used window, without the reset time. */
  compact?: boolean;
  open?: boolean;
};

let { usages = [], compact = false, open = $bindable(false) }: Props = $props();

function clampPercent(value: number | null | undefined): number {
  if (value == null) return 0;
  return Math.min(100, Math.max(0, value));
}

const TEXT_TONE: Record<MeterTone, string> = {
  success: "",
  warning: "text-warning",
  destructive: "text-destructive",
};

const BAR_TONE: Record<MeterTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive-solid",
};

function updatedLabel(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const entries = $derived(usages);
const triggerEntry = $derived(selectUsageTriggerEntry(entries));
const allTriggerMeters = $derived(quotaMeters(triggerEntry?.usage));
// Time windows all show (session and weekly); count allowances show only the
// plan's primary allowance. Compact keeps whichever is closest to its limit.
const triggerMeters = $derived.by((): DisplayMeter[] => {
  const windows = allTriggerMeters.filter((item) => item.abbreviation);
  const counts = allTriggerMeters.filter((item) => !item.abbreviation);
  const meters = [...windows, ...counts.slice(0, 1)];
  if (!compact || meters.length <= 1) return meters;
  return [
    meters.reduce((worst, item) =>
      (item.quota.usedPercent ?? 0) > (worst.quota.usedPercent ?? 0)
        ? item
        : worst,
    ),
  ];
});
const triggerConsumption = $derived<SubscriptionQuota | undefined>(
  triggerMeters.length === 0
    ? consumptionQuotas(triggerEntry?.usage)[0]
    : undefined,
);
const triggerReset = $derived(
  compact || !triggerMeters[0] ? null : quotaResetShort(triggerMeters[0].quota),
);

const lastUpdated = $derived.by(() => {
  const stamps = entries
    .map((entry) => entry.usage?.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return updatedLabel(stamps.at(-1));
});

const title = $derived.by(() => {
  const lines: string[] = [];
  for (const entry of entries) {
    const details = [
      ...quotaMeters(entry.usage).map(
        (item) =>
          `${item.label.toLowerCase()} ${percentLabel(item.quota.usedPercent)}`,
      ),
      ...consumptionQuotas(entry.usage).map(
        (quota) => `${quota.label} ${consumptionValue(quota)}`,
      ),
    ].join(" / ");
    lines.push(
      `${subscriptionProviderLabel(entry.provider)} — ${details || "No data"}`,
    );
  }
  return lines.join("\n");
});
</script>

{#if triggerEntry}
  <Popover
    bind:open
    size="md"
    triggerClass={STATUS_BAR_CHIP_BUTTON}
    ariaLabel="Open subscription usage details"
    side="top"
    align="end"
  >
    {#snippet trigger()}
      <span class="inline-flex items-center gap-1.5 whitespace-nowrap" {title}>
        <span>{subscriptionProviderLabel(triggerEntry.provider)}</span>
        {#if triggerConsumption}
          <span
            class={cn(
              "tabular-nums",
              triggerConsumption.exhausted && "text-destructive",
            )}>{consumptionChipValue(triggerConsumption)}</span
          >
        {:else if triggerMeters.length === 0}
          <span aria-label="No data">—</span>
        {/if}
        {#each triggerMeters as item (item.quota.id)}
          {@const percent = item.quota.usedPercent}
          {@const tone = meterTone(item.quota)}
          <span class="inline-flex items-center gap-1">
            {#if item.abbreviation}<span>{item.abbreviation}</span>{/if}
            <span class="h-1 w-6 overflow-hidden rounded-full bg-border">
              <span
                class={cn("block h-full rounded-full", BAR_TONE[tone])}
                style="width: {clampPercent(percent)}%"
              ></span>
            </span>
            <span class={cn("tabular-nums", TEXT_TONE[tone])}
              >{percentLabel(percent)}</span
            >
          </span>
        {/each}
        {#if triggerReset}
          <span class="tabular-nums">{triggerReset}</span>
        {/if}
      </span>
    {/snippet}

    <PopoverHeader
      title="Subscription usage"
      meta={lastUpdated ? `Updated ${lastUpdated}` : undefined}
    />

    <PopoverBody>
      {#each entries as entry, index (entry.provider)}
        <PopoverSection
          label={`${subscriptionProviderLabel(entry.provider)}${entry.usage?.planType ? ` · ${entry.usage.planType}` : ""}`}
          separated={index > 0}
        >
          {#snippet action()}
            {#if entry.active}
              <Badge variant="neutral">Active</Badge>
            {/if}
          {/snippet}

          <SubscriptionQuotaList usage={entry.usage} />
        </PopoverSection>
      {/each}
    </PopoverBody>
  </Popover>
{/if}
