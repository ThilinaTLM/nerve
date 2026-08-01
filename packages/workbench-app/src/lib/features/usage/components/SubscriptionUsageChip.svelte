<script lang="ts">
import type { SubscriptionUsage, SubscriptionWindow } from "$lib/api";
import type { SubscriptionUsageEntry } from "$lib/features/usage/state/usage-selectors.svelte";
import {
  formatResetAfterSeconds,
  formatResetAt,
  usageTone,
  usageWindowDisplay,
} from "@nervekit/ui-kit/core/utils/usage";
import { cn } from "@nervekit/ui-kit/core/utils";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";

type Props = {
  usages?: SubscriptionUsageEntry[];
  /** Phone widths: show only the most-used window, without the reset time. */
  compact?: boolean;
};

let { usages = [], compact = false }: Props = $props();

function windowReset(
  window: SubscriptionWindow | null | undefined,
): string | null {
  if (!window) return null;
  return (
    formatResetAt(window.resetsAt) ??
    formatResetAfterSeconds(window.resetAfterSeconds)
  );
}

function percentLabel(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function clampPercent(value: number | null | undefined): number {
  if (value == null) return 0;
  return Math.min(100, Math.max(0, value));
}

function providerLabel(provider: string): string {
  if (provider === "openai-codex") return "Codex";
  if (provider === "anthropic") return "Anthropic";
  return provider;
}

type DisplayWindow = {
  slot: "session" | "weekly";
  window: SubscriptionWindow;
  label: string;
  abbreviation: string;
};

function displayWindows(
  usage: SubscriptionUsage | null | undefined,
): DisplayWindow[] {
  if (!usage) return [];
  const windows: DisplayWindow[] = [];

  if (usage.session) {
    windows.push({
      slot: "session",
      window: usage.session,
      ...usageWindowDisplay(usage.session.windowMinutes, {
        label: "Session",
        abbreviation: "S",
      }),
    });
  }
  if (usage.weekly) {
    windows.push({
      slot: "weekly",
      window: usage.weekly,
      ...usageWindowDisplay(usage.weekly.windowMinutes, {
        label: "Weekly",
        abbreviation: "W",
      }),
    });
  }

  return windows;
}

/** Tailwind text color for a usage percent (neutral inherits the surrounding tone). */
function toneTextClass(percent: number | null | undefined): string {
  const tone = usageTone(percent);
  if (tone === "error") return "text-destructive";
  if (tone === "warning") return "text-warning";
  return "";
}

/** Tailwind fill color for a usage progress bar. */
function toneBarClass(percent: number | null | undefined): string {
  const tone = usageTone(percent);
  if (tone === "error") return "bg-destructive-solid";
  if (tone === "warning") return "bg-warning";
  return "bg-success";
}

function updatedLabel(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const entries = $derived(usages);
const hasData = $derived(
  entries.some((entry) => displayWindows(entry.usage).length > 0),
);

// Trigger reflects the active model's provider, falling back to any with data.
const triggerEntry = $derived(
  entries.find(
    (entry) => entry.active && displayWindows(entry.usage).length > 0,
  ) ?? entries.find((entry) => displayWindows(entry.usage).length > 0),
);
const allTriggerWindows = $derived(displayWindows(triggerEntry?.usage));
// Compact keeps whichever window is closest to its limit, since that is the
// one worth surfacing when there is only room for a single meter.
const triggerWindows = $derived.by(() => {
  if (!compact || allTriggerWindows.length <= 1) return allTriggerWindows;
  return [
    allTriggerWindows.reduce((worst, item) =>
      (item.window.usedPercent ?? 0) > (worst.window.usedPercent ?? 0)
        ? item
        : worst,
    ),
  ];
});
const triggerReset = $derived(
  compact ? null : windowReset(triggerWindows[0]?.window),
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
    const windows = displayWindows(entry.usage);
    if (windows.length === 0) continue;
    const details = windows
      .map(
        (item) =>
          `${item.label.toLowerCase()} ${percentLabel(item.window.usedPercent)}`,
      )
      .join(" / ");
    lines.push(`${providerLabel(entry.provider)} — ${details}`);
  }
  return lines.join("\n");
});
</script>

{#snippet usageRow(item: DisplayWindow)}
  {@const percent = item.window.usedPercent ?? null}
  {@const reset = windowReset(item.window)}
  <div class="flex flex-col gap-1">
    <div class="flex items-center justify-between gap-2 text-xs">
      <span class="text-muted-foreground">{item.label}</span>
      <span class={cn("font-medium tabular-nums", toneTextClass(percent))}
        >{percentLabel(percent)}</span
      >
    </div>
    <div class="h-1 overflow-hidden rounded-full bg-muted">
      <div
        class={cn("h-full rounded-full", toneBarClass(percent))}
        style="width: {clampPercent(percent)}%"
      ></div>
    </div>
    {#if reset}
      <span class="text-xs text-muted-foreground">resets in {reset}</span>
    {/if}
  </div>
{/snippet}

{#if hasData}
  <Popover
    class="popover-md"
    triggerClass="usage-trigger-wrap"
    ariaLabel="Open subscription usage details"
    side="top"
    align="end"
  >
    {#snippet trigger()}
      <span class="usage-trigger" {title}>
        {#each triggerWindows as item (item.slot)}
          {@const percent = item.window.usedPercent}
          <span class="usage-meter">
            <span class="usage-meter-label">{item.abbreviation}</span>
            <span class="usage-meter-track">
              <span
                class={cn("usage-meter-fill", toneBarClass(percent))}
                style="width: {clampPercent(percent)}%"
              ></span>
            </span>
            <span class={cn("usage-meter-value", toneTextClass(percent))}
              >{percentLabel(percent)}</span
            >
          </span>
        {/each}
        {#if triggerReset}
          <span class="usage-reset">{triggerReset}</span>
        {/if}
      </span>
    {/snippet}

    <PopoverBody>
      <PopoverHeader
        title="Subscription usage"
        meta={lastUpdated ? `Updated ${lastUpdated}` : undefined}
      />

      {#each entries as entry, index (entry.provider)}
        <PopoverSection separated={index > 0}>
          <div class="flex items-baseline justify-between gap-2">
            <span class="flex items-baseline gap-1.5 text-xs font-medium">
              {providerLabel(entry.provider)}
              {#if entry.usage?.planType}
                <span class="font-normal text-muted-foreground"
                  >· {entry.usage.planType}</span
                >
              {/if}
            </span>
            {#if entry.active}
              <Badge size="xs" tone="neutral">Active</Badge>
            {/if}
          </div>

          {#if entry.usage}
            {@const windows = displayWindows(entry.usage)}
            {#if windows.length > 0}
              {#each windows as item (item.slot)}
                {@render usageRow(item)}
              {/each}
            {:else}
              <span class="text-muted-foreground">No data</span>
            {/if}
          {:else}
            <span class="text-muted-foreground">No data</span>
          {/if}
        </PopoverSection>
      {/each}
    </PopoverBody>
  </Popover>
{/if}

<style>
.usage-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}

.usage-meter {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.usage-meter-label {
  color: var(--muted-foreground);
}

.usage-meter-track {
  position: relative;
  overflow: hidden;
  width: 1.5rem;
  height: 0.25rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--muted-foreground) 28%, transparent);
}

.usage-meter-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.usage-meter-value,
.usage-reset {
  font-variant-numeric: tabular-nums;
}

.usage-reset {
  color: var(--muted-foreground);
}
</style>
