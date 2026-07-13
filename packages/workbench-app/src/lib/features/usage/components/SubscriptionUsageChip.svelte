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
import Popover from "@nervekit/ui-kit/components/ui/popover-panel";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import type { StatusTone } from "@nervekit/ui-kit/core/utils/status";

type Props = {
  usages?: SubscriptionUsageEntry[];
};

let { usages = [] }: Props = $props();

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
  if (tone === "error") return "bg-destructive";
  if (tone === "warning") return "bg-warning";
  return "bg-success";
}

function dotTone(percent: number | null | undefined): StatusTone {
  const tone = usageTone(percent);
  if (tone === "error") return "danger";
  if (tone === "warning") return "warn";
  return "good";
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
const triggerWindows = $derived(displayWindows(triggerEntry?.usage));
const triggerTone = $derived(
  dotTone(
    Math.max(0, ...triggerWindows.map((item) => item.window.usedPercent ?? 0)),
  ),
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
    class="subscription-popover"
    triggerClass="subscription-trigger-wrap"
    ariaLabel="Open subscription usage details"
    side="top"
    align="end"
  >
    {#snippet trigger()}
      <span class="subscription-trigger" {title}>
        <StatusDot
          tone={triggerTone}
          pulse={triggerTone !== "good"}
          size="xs"
        />
        {#each triggerWindows as item, index (item.slot)}
          {@const percent = item.window.usedPercent}
          {@const reset = index === 0 ? windowReset(item.window) : null}
          {#if index > 0}<span class="trigger-muted">/</span>{/if}
          <span class={cn("trigger-part", toneTextClass(percent))}>
            {item.abbreviation}:{percentLabel(percent)}{#if reset != null}
              <span class="trigger-muted">({reset})</span>{/if}
          </span>
        {/each}
      </span>
    {/snippet}

    <div class="flex flex-col gap-3 p-3">
      <header
        class="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5"
      >
        <strong class="text-sm font-semibold">Subscription usage</strong>
        {#if lastUpdated}
          <span class="text-xs text-muted-foreground"
            >Updated {lastUpdated}</span
          >
        {/if}
      </header>

      <div class="flex flex-col gap-2.5">
        {#each entries as entry (entry.provider)}
          <section
            class={cn(
              "flex flex-col gap-2 rounded-md border border-border/60 p-2.5",
              entry.active && "bg-muted/40",
            )}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="flex items-baseline gap-1.5 text-xs font-semibold">
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
                <span class="text-xs text-muted-foreground">No data</span>
              {/if}
            {:else}
              <span class="text-xs text-muted-foreground">No data</span>
            {/if}
          </section>
        {/each}
      </div>
    </div>
  </Popover>
{/if}

<style>
.subscription-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  height: 100%;
  color: var(--muted-foreground);
  padding: 0 0.6rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
}

.trigger-muted {
  color: var(--muted-foreground);
}

:global(.subscription-trigger-wrap) {
  height: 100%;
}

:global(.subscription-trigger-wrap:hover),
:global(.subscription-trigger-wrap[data-state="open"]) {
  background: var(--accent);
}

:global(.subscription-trigger-wrap:hover) .subscription-trigger,
:global(.subscription-trigger-wrap[data-state="open"]) .subscription-trigger {
  color: var(--foreground);
}
</style>
