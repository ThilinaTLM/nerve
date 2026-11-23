<script lang="ts">
import {
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { onMount } from "svelte";
import MaintenanceProgressView from "$lib/presentation/maintenance/MaintenanceProgressView.svelte";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { SettingsSection } from "$lib/presentation/settings";
import StorageCleanupDialog from "./StorageCleanupDialog.svelte";
import { formatBytes, percentOfTotal } from "./storage-format";
import type { StoragePageController } from "./storage-page-state.svelte";

type Props = {
  controller: StoragePageController;
};

let { controller }: Props = $props();

const categoryTones = [
  { bg: "bg-chart-1", stroke: "stroke-chart-1" },
  { bg: "bg-chart-2", stroke: "stroke-chart-2" },
  { bg: "bg-chart-3", stroke: "stroke-chart-3" },
  { bg: "bg-chart-4", stroke: "stroke-chart-4" },
  { bg: "bg-chart-5", stroke: "stroke-chart-5" },
  { bg: "bg-primary", stroke: "stroke-primary" },
  { bg: "bg-info", stroke: "stroke-info" },
  { bg: "bg-warning", stroke: "stroke-warning" },
];

const usage = $derived(controller.usage);
const operation = $derived(controller.operation);
const totalBytes = $derived(usage?.totalBytes ?? 0);
const categories = $derived(
  [...(usage?.categories ?? [])]
    .filter((category) => category.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes),
);
const categorySegments = $derived.by(() => {
  let offset = 0;
  return categories.map((category, index) => {
    const percent = totalBytes > 0 ? (category.bytes / totalBytes) * 100 : 0;
    const segment = {
      category,
      percent,
      offset,
      tone: categoryTones[index % categoryTones.length],
    };
    offset += percent;
    return segment;
  });
});
const chartLabel = $derived(
  `Storage usage breakdown: ${formatBytes(totalBytes)} total. ${categorySegments
    .map(
      (segment) => `${segment.category.label} ${Math.round(segment.percent)}%`,
    )
    .join(", ")}.`,
);
/** File count first, so a long description truncates instead of it. */
function categorySummary(category: (typeof categories)[number]): string {
  const files = `${category.fileCount.toLocaleString()} ${category.fileCount === 1 ? "file" : "files"}`;
  const conversations =
    category.key === "payloads" && usage
      ? ` · ${usage.conversations.total.toLocaleString()} conversations`
      : "";
  return `${files}${conversations} · ${category.description}`;
}

onMount(() => {
  controller.start();
  return () => controller.dispose();
});
</script>

{#if controller.errorMessage}
  <Callout layout="block" tone="destructive" text={controller.errorMessage} />
{/if}

{#if operation}
  <SettingsSection surface={false}
    ><MaintenanceProgressView
      {operation}
      onCancel={() => void controller.cancelCleanup()}
    /></SettingsSection
  >
{/if}

{#if controller.loading && !usage}
  <SettingsSection surface={false}>
    <Skeleton class="h-16 w-full" />
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-9 w-full" />
  </SettingsSection>
{:else if usage}
  <SettingsSection surface={false}>
    <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div class="grid gap-1">
        <span class="text-ui text-muted-foreground">Total local data</span>
        <span class="text-title font-medium">{formatBytes(totalBytes)}</span>
        <span
          class="truncate font-mono text-ui text-muted-foreground"
          title={usage.homeDir}>{usage.homeDir}</span
        >
        <span class="text-ui text-muted-foreground">
          Calculated {new Date(usage.generatedAt).toLocaleString()}
        </span>
      </div>
      <div
        class="relative mx-auto size-28 sm:mx-0"
        role="img"
        aria-label={chartLabel}
      >
        <svg viewBox="0 0 100 100" class="size-full">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke-width="14"
            class="stroke-muted"
          />
          <g transform="rotate(-90 50 50)">
            {#each categorySegments as segment (segment.category.key)}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke-width="14"
                stroke-linecap="butt"
                pathLength="100"
                class={segment.tone.stroke}
                stroke-dasharray={`${segment.percent} ${100 - segment.percent}`}
                stroke-dashoffset={-segment.offset}
              />
            {/each}
          </g>
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-title font-medium leading-none"
            >{formatBytes(totalBytes)}</span
          >
          <span class="text-ui text-muted-foreground">Total</span>
        </div>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    surface={false}
    title="What uses space"
    info="Categories are ordered by current footprint."
  >
    <PageList ariaLabel="Storage categories">
      {#each categories as category, index (category.key)}
        <PageItem title={category.label} summary={categorySummary(category)}>
          {#snippet leading()}
            <span
              class={`size-2 flex-none rounded-full ${categoryTones[index % categoryTones.length].bg}`}
              aria-hidden="true"
            ></span>
          {/snippet}
          {#snippet meta()}
            <span class="text-caption text-muted-foreground">
              <span class="font-mono">{formatBytes(category.bytes)}</span>
              · {percentOfTotal(category.bytes, totalBytes)}%
              {#if category.protected}
                · Protected
              {/if}
              {#if category.cleanable}
                · Cleanable
              {/if}
            </span>
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  </SettingsSection>
{/if}

<StorageCleanupDialog
  bind:open={controller.cleanupDialogOpen}
  usage={controller.usage}
  onStart={(request) => void controller.startCleanup(request)}
/>
