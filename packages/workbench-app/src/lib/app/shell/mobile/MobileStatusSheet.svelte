<script lang="ts">
import {
  PopoverBody,
  PopoverHeader,
  PopoverMeter,
  PopoverProperties,
  PopoverProperty,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import {
  formatDurationMinutes,
  formatResetAfterSeconds,
  formatResetAt,
  usageTone,
  usageWindowDisplay,
} from "@nervekit/ui-kit/display/usage";
import { usageSelectors } from "$lib/application/usage/usage-selectors.svelte";
import { maintenance, workspaceSelectors } from "$lib/application/workspace";
import MaintenanceStatus from "$lib/app/shell/MaintenanceStatus.svelte";
import {
  mobileConnectionText,
  mobileStatusSheet,
} from "./mobile-status.svelte";
import { providerLabel } from "./mobile-status";

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

type Row = {
  key: string;
  label: string;
  percent: number | null;
  reset: string;
};

function usageRows(entry: (typeof usages)[number]): Row[] {
  const rows: Row[] = [];
  for (const [slot, window, fallback] of [
    ["session", entry.usage?.session, { label: "Session", abbreviation: "S" }],
    ["weekly", entry.usage?.weekly, { label: "Weekly", abbreviation: "W" }],
  ] as const) {
    if (!window) continue;
    rows.push({
      key: slot,
      label: usageWindowDisplay(window.windowMinutes, fallback).label,
      percent: window.usedPercent ?? null,
      reset:
        formatResetAt(window.resetsAt) ??
        formatResetAfterSeconds(window.resetAfterSeconds) ??
        "",
    });
  }
  return rows;
}

function meterTone(percent: number | null) {
  const tone = usageTone(percent);
  return tone === "error"
    ? "destructive"
    : tone === "warning"
      ? "warning"
      : "success";
}
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
        <PopoverHeader title={`${providerLabel(entry.provider)} usage`} />
        <PopoverBody>
          {#each usageRows(entry) as row (row.key)}
            <PopoverMeter
              label={row.label}
              value={row.percent == null ? "—" : `${Math.round(row.percent)}%`}
              percent={row.percent ?? undefined}
              tone={meterTone(row.percent)}
              caption={row.reset ? `resets in ${row.reset}` : undefined}
            />
          {:else}
            <p class="px-1.5 text-muted-foreground">No data</p>
          {/each}
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
