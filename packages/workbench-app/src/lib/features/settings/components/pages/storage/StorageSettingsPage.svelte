<script lang="ts">
import { onMount } from "svelte";
import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  SettingsDisclosureItem,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsListItem,
} from "$lib/presentation/components/settings";
import {
  cleanupProgress,
  targetLabel,
} from "$lib/features/settings/state/storage-cleanup";
import StorageCleanupDialog from "./StorageCleanupDialog.svelte";
import { formatBytes, percentOfTotal } from "./storage-format";
import type { StoragePageController } from "./storage-page-state.svelte";

type Props = {
  controller: StoragePageController;
};

let { controller }: Props = $props();

const categoryTones = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-primary",
  "bg-info",
  "bg-warning",
];

const usage = $derived(controller.usage);
const operation = $derived(controller.operation);
const totalBytes = $derived(usage?.totalBytes ?? 0);
const categories = $derived(
  [...(usage?.categories ?? [])]
    .filter((category) => category.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes),
);
const active = $derived(controller.active);
const progressValue = $derived(operation ? cleanupProgress(operation) : 0);
const completedWithIssues = $derived(
  operation?.results.some((result) => result.outcome === "failed") ?? false,
);
const indexBytes = $derived(
  usage
    ? usage.sqlite.dbBytes + usage.sqlite.walBytes + usage.sqlite.shmBytes
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

{#if controller.loading && !usage}
  <SettingsGroup>
    <Skeleton class="h-16 w-full" />
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-9 w-full" />
  </SettingsGroup>
{:else if usage}
  <SettingsGroup>
    <div class="grid gap-1">
      <span class="text-xs text-muted-foreground">Total local data</span>
      <span class="text-2xl font-semibold">{formatBytes(totalBytes)}</span>
      <span
        class="truncate font-mono text-xs text-muted-foreground"
        title={usage.dataDir}>{usage.dataDir}</span
      >
      <span class="text-xs text-muted-foreground">
        Calculated {new Date(usage.generatedAt).toLocaleString()}
      </span>
    </div>
    <div
      class="flex h-2.5 overflow-hidden rounded-full bg-muted"
      aria-label={`Storage usage total ${formatBytes(totalBytes)}`}
    >
      {#each categories as category, index (category.key)}
        <span
          class={categoryTones[index % categoryTones.length]}
          style={`width: ${Math.max(percentOfTotal(category.bytes, totalBytes), 1)}%`}
          title={`${category.label}: ${formatBytes(category.bytes)}`}
        ></span>
      {/each}
    </div>
  </SettingsGroup>

  {#if operation && (active || operation.completedAt)}
    <SettingsGroup>
      <div class="grid gap-2" aria-live="polite">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-2">
            {#if active}
              <Spinner class="mt-0.5 size-4 shrink-0 text-primary" />
            {:else if operation.status === "succeeded" && !completedWithIssues}
              <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-success" />
            {:else}
              <CircleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
            {/if}
            <div class="min-w-0">
              <p class="text-sm font-medium">
                {active
                  ? "Cleanup in progress"
                  : operation.status === "cancelled"
                    ? "Cleanup cancelled"
                    : completedWithIssues
                      ? "Cleanup completed with issues"
                      : operation.status === "failed"
                        ? "Cleanup failed"
                        : "Cleanup complete"}
              </p>
              <p class="text-xs text-muted-foreground">{operation.message}</p>
            </div>
          </div>
          {#if active && operation.cancellable}
            <Button
              size="xs"
              variant="outline"
              onclick={() => void controller.cancelCleanup()}
              >Cancel cleanup</Button
            >
          {:else if !active}
            <Button
              size="xs"
              variant="outline"
              onclick={() => (controller.cleanupDialogOpen = true)}
            >
              <RotateCcw class="size-3.5" aria-hidden="true" /> Clean more
            </Button>
          {/if}
        </div>

        {#if active}
          <Progress value={progressValue} aria-label="Cleanup progress" />
          <p class="text-xs text-muted-foreground">
            {operation.completedTargets} of {operation.totalTargets} targets complete
            {#if operation.status === "cancelling"}
              · stopping after the current target{/if}
            {#if !operation.cancellable}
              · this index step cannot be interrupted safely{/if}
          </p>
        {:else}
          <p class="text-sm">
            <strong class="text-base"
              >{formatBytes(operation.freedBytes)}</strong
            >
            <span class="text-xs text-muted-foreground">freed</span>
          </p>
        {/if}

        {#if !active && operation.results.length > 0}
          <SettingsList ariaLabel="Cleanup results">
            {#each operation.results as result (result.target)}
              <SettingsListItem
                title={targetLabel(result.target)}
                description={result.error ?? result.note}
              >
                {#snippet badges()}
                  <Badge
                    size="xs"
                    tone={result.outcome === "succeeded"
                      ? "good"
                      : result.outcome === "failed"
                        ? "danger"
                        : "neutral"}>{result.outcome}</Badge
                  >
                {/snippet}
                {#snippet meta()}
                  <span class="font-mono">{formatBytes(result.freedBytes)}</span
                  >
                  {#if result.removedItems > 0}
                    <span>· {result.removedItems} removed</span>
                  {/if}
                  {#if result.skipped > 0}
                    <span>· {result.skipped} skipped</span>
                  {/if}
                {/snippet}
              </SettingsListItem>
            {/each}
          </SettingsList>
        {/if}
      </div>
    </SettingsGroup>
  {/if}

  <SettingsGroup
    title="What uses space"
    description="Categories are ordered by current footprint."
  >
    <SettingsList ariaLabel="Storage categories">
      {#each categories as category, index (category.key)}
        <SettingsDisclosureItem
          title={category.label}
          description={category.description}
        >
          {#snippet leading()}
            <span
              class={`size-2 flex-none rounded-full ${categoryTones[index % categoryTones.length]}`}
              aria-hidden="true"
            ></span>
          {/snippet}
          {#snippet badges()}
            {#if category.protected}
              <Badge size="xs" variant="secondary">Protected</Badge>
            {/if}
            {#if category.cleanable}
              <Badge size="xs" variant="outline">Cleanable</Badge>
            {/if}
          {/snippet}
          {#snippet meta()}
            <span class="font-mono">{formatBytes(category.bytes)}</span>
            <span>· {percentOfTotal(category.bytes, totalBytes)}%</span>
          {/snippet}
          {#snippet detail()}
            <p>{category.description}</p>
            <p>
              {category.fileCount.toLocaleString()} files ·
              <span class="font-mono">{category.bytes.toLocaleString()}</span>
              bytes
            </p>
            {#if category.key === "sqliteIndex"}
              <p>
                Search index total <span class="font-mono"
                  >{formatBytes(indexBytes)}</span
                > across the database, write-ahead log, and shared memory files. It
                can be rebuilt into a fresh compact index.
              </p>
            {/if}
            {#if category.key === "conversations"}
              <p>
                {usage.conversations.total.toLocaleString()} conversations stored.
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
