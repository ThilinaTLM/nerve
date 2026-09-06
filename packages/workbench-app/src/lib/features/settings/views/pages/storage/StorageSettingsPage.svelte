<script lang="ts">
import { onMount } from "svelte";
import MaintenanceProgressView from "$lib/presentation/maintenance/MaintenanceProgressView.svelte";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import {
  SettingsDisclosureItem,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
} from "$lib/presentation/settings";
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
const databaseBytes = $derived(
  usage
    ? usage.database.dbBytes + usage.database.walBytes + usage.database.shmBytes
    : 0,
);

onMount(() => {
  controller.start();
  return () => controller.dispose();
});
</script>

{#if controller.errorMessage}
  <SettingsInlineMessage tone="error" text={controller.errorMessage} />
{/if}

{#if operation}
  <SettingsGroup
    ><MaintenanceProgressView
      {operation}
      onCancel={() => void controller.cancelCleanup()}
    /></SettingsGroup
  >
{/if}

{#if controller.loading && !usage}
  <SettingsGroup>
    <Skeleton class="h-16 w-full" />
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-9 w-full" />
  </SettingsGroup>
{:else if usage}
  <SettingsGroup>
    <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div class="grid gap-1">
        <span class="text-xs text-muted-foreground">Total local data</span>
        <span class="text-2xl font-semibold">{formatBytes(totalBytes)}</span>
        <span
          class="truncate font-mono text-xs text-muted-foreground"
          title={usage.homeDir}>{usage.homeDir}</span
        >
        <span class="text-xs text-muted-foreground">
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
          <span class="text-lg font-semibold leading-none"
            >{formatBytes(totalBytes)}</span
          >
          <span class="text-xs text-muted-foreground">Total</span>
        </div>
      </div>
    </div>
  </SettingsGroup>

  <SettingsGroup
    title="What uses space"
    description="Categories are ordered by current footprint."
  >
    <SettingsList ariaLabel="Storage categories" divided={false} gap="sm">
      {#each categories as category, index (category.key)}
        <SettingsDisclosureItem
          variant="card"
          title={category.label}
          description={category.description}
        >
          {#snippet titleSuffix()}
            <span
              class={`size-2 flex-none rounded-full ${categoryTones[index % categoryTones.length].bg}`}
              aria-hidden="true"
            ></span>
          {/snippet}
          {#snippet meta()}
            <span class="font-mono">{formatBytes(category.bytes)}</span>
            <span>· {percentOfTotal(category.bytes, totalBytes)}%</span>
            {#if category.protected}
              <span class="text-muted-foreground">· Protected</span>
            {/if}
            {#if category.cleanable}
              <span class="text-muted-foreground">· Cleanable</span>
            {/if}
          {/snippet}
          {#snippet detail()}
            <p>
              {category.fileCount.toLocaleString()} files ·
              <span class="font-mono">{category.bytes.toLocaleString()}</span>
              bytes
            </p>
            {#if category.key === "database"}
              <p>
                Canonical database total <span class="font-mono"
                  >{formatBytes(databaseBytes)}</span
                > across the database, write-ahead log, and shared memory files. This
                authoritative state is never removed by cleanup.
              </p>
            {/if}
            {#if category.key === "payloads"}
              <p>
                Retained payload footprints for
                {usage.conversations.total.toLocaleString()} conversations.
              </p>
              {#if usage.conversations.largest.length > 0}
                <ul class="grid gap-1">
                  {#each usage.conversations.largest.slice(0, 3) as conversation (conversation.conversationId)}
                    <li class="flex min-w-0 justify-between gap-3">
                      <span
                        class="truncate"
                        title={conversation.title ??
                          conversation.conversationId}
                        >{conversation.title ??
                          conversation.conversationId}</span
                      >
                      <span class="flex-none font-mono"
                        >{formatBytes(conversation.bytes)}</span
                      >
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/snippet}
        </SettingsDisclosureItem>
      {/each}
    </SettingsList>
  </SettingsGroup>
{/if}

<StorageCleanupDialog
  bind:open={controller.cleanupDialogOpen}
  usage={controller.usage}
  onStart={(request) => void controller.startCleanup(request)}
/>
