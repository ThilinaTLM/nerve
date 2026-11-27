<script lang="ts">
import {
  PageEmptyState,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import Eraser from "@lucide/svelte/icons/eraser";
import Lock from "@lucide/svelte/icons/lock";
import MessageSquare from "@lucide/svelte/icons/message-square";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { onMount } from "svelte";
import type { StorageCategoryUsage } from "@nervekit/contracts/storage";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import { SettingsSection } from "$lib/presentation/settings";
import StorageCleanupDialog from "./StorageCleanupDialog.svelte";
import StorageCleanupStatus from "./StorageCleanupStatus.svelte";
import {
  BREAKDOWN_REST_TONE,
  categoryCleanupTarget,
  formatBytes,
  percentLabel,
  storageBreakdown,
  type BreakdownCategory,
} from "./storage-format";
import type { StoragePageController } from "./storage-page-state.svelte";

type Props = {
  controller: StoragePageController;
};

let { controller }: Props = $props();

let showSmall = $state(false);
let now = $state(Date.now());

const usage = $derived(controller.usage);
const shownOperation = $derived(controller.shownOperation);
const totalBytes = $derived(usage?.totalBytes ?? 0);
const breakdown = $derived(
  storageBreakdown(usage?.categories ?? [], totalBytes),
);
/** The bar: coloured categories, then everything else as one neutral segment. */
const segments = $derived.by(() => {
  const all = [...breakdown.major, ...breakdown.minor];
  const coloured = all.filter((item) => item.tone !== BREAKDOWN_REST_TONE);
  const restBytes = all
    .filter((item) => item.tone === BREAKDOWN_REST_TONE)
    .reduce((sum, item) => sum + item.bytes, 0);
  return [
    ...coloured.map((item) => ({
      key: item.key,
      label: item.label,
      bytes: item.bytes,
      tone: item.tone,
    })),
    ...(restBytes > 0
      ? [
          {
            key: "rest",
            label: "Everything else",
            bytes: restBytes,
            tone: BREAKDOWN_REST_TONE,
          },
        ]
      : []),
  ];
});
const shownCategories = $derived(
  showSmall ? [...breakdown.major, ...breakdown.minor] : breakdown.major,
);
const largest = $derived(usage?.conversations.largest ?? []);
const conversationBytes = $derived(
  usage?.categories.find((category) => category.key === "payloads")?.bytes ?? 0,
);
const updated = $derived(
  usage ? relativeTimeLabel(usage.generatedAt, { style: "long", now }) : "",
);
const cleanupBlocked = $derived(controller.active);

function categorySummary(category: StorageCategoryUsage): string {
  const files = `${category.fileCount.toLocaleString()} ${category.fileCount === 1 ? "file" : "files"}`;
  const conversations =
    category.key === "payloads" && usage
      ? ` · ${usage.conversations.total.toLocaleString()} conversations`
      : "";
  return `${files}${conversations} · ${category.description}`;
}

function freeUp(category: BreakdownCategory): void {
  controller.openCleanup(categoryCleanupTarget(category.key));
}

onMount(() => {
  controller.start();
  // "Updated 2 min ago" ages without any event.
  const timer = setInterval(() => (now = Date.now()), 30_000);
  return () => {
    clearInterval(timer);
    controller.dispose();
  };
});
</script>

{#if shownOperation}
  <StorageCleanupStatus
    operation={shownOperation}
    onCancel={() => void controller.cancelCleanup()}
    onDismiss={() => controller.dismissResult()}
  />
{/if}

{#if controller.loading && !usage}
  <SettingsSection surface={false}>
    <div class="grid gap-2">
      <Skeleton class="h-5 w-24" />
      <Skeleton class="h-4 w-64" />
      <Skeleton class="h-2 w-full" />
    </div>
    <Skeleton class="h-56 w-full" />
  </SettingsSection>
{:else if !usage}
  <SettingsSection surface={false}>
    <PageEmptyState
      variant="card"
      icon={TriangleAlert}
      title="Couldn't measure storage"
      description={controller.errorMessage}
    >
      {#snippet actions()}
        <Button
          size="sm"
          variant="outline"
          onclick={() => void controller.loadUsage(true)}>Try again</Button
        >
      {/snippet}
    </PageEmptyState>
  </SettingsSection>
{:else}
  <SettingsSection surface={false}>
    <div class="grid gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <div class="grid min-w-0 flex-1 gap-0.5">
          <span class="text-title font-medium">{formatBytes(totalBytes)}</span>
          <span
            class="flex min-w-0 items-center gap-1 text-caption text-muted-foreground"
          >
            <span>in</span>
            <span class="truncate font-mono" title={usage.homeDir}
              >{usage.homeDir}</span
            >
            <span aria-hidden="true">·</span>
            {#if controller.refreshing}
              <span class="flex-none">Updating</span>
            {:else if controller.errorMessage}
              <span
                class="flex-none text-warning"
                title={controller.errorMessage}
                >Couldn't update, showing {updated}</span
              >
            {:else}
              <span
                class="flex-none"
                title={new Date(usage.generatedAt).toLocaleString()}
                >Updated {updated}</span
              >
            {/if}
          </span>
        </div>
        <IconAction
          icon={RefreshCw}
          label={controller.errorMessage ? "Try again" : "Measure again"}
          busy={controller.refreshing}
          disabled={cleanupBlocked}
          onclick={() => void controller.loadUsage(true)}
        />
      </div>
      <Tooltip.Provider delayDuration={150}>
        <div
          class="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${formatBytes(totalBytes)} used: ${segments
            .map(
              (segment) =>
                `${segment.label} ${percentLabel(segment.bytes, totalBytes)}`,
            )
            .join(", ")}`}
        >
          {#each segments as segment (segment.key)}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <span
                    {...props}
                    class={`h-full min-w-0.5 ${segment.tone}`}
                    style:flex-grow={segment.bytes}
                    style:flex-basis="0"
                  ></span>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content
                >{segment.label} · {formatBytes(segment.bytes)} · {percentLabel(
                  segment.bytes,
                  totalBytes,
                )}</Tooltip.Content
              >
            </Tooltip.Root>
          {/each}
        </div>
      </Tooltip.Provider>
    </div>
  </SettingsSection>

  <SettingsSection surface={false} title="What uses space">
    <PageList ariaLabel="Storage categories">
      {#each shownCategories as category (category.key)}
        {@const target = category.cleanable
          ? categoryCleanupTarget(category.key)
          : undefined}
        <PageItem title={category.label} summary={categorySummary(category)}>
          {#snippet leading()}
            <span
              class={`size-2 flex-none rounded-full ${category.tone}`}
              aria-hidden="true"
            ></span>
          {/snippet}
          {#snippet badges()}
            {#if category.protected}
              <span
                class="inline-flex text-muted-foreground"
                title="Cleanup never removes this"
              >
                <Lock class="size-3" aria-label="Cleanup never removes this" />
              </span>
            {/if}
          {/snippet}
          {#snippet meta()}
            <span class="grid justify-items-end tabular-nums">
              <span class="text-ui text-foreground"
                >{formatBytes(category.bytes)}</span
              >
              <span class="text-caption text-muted-foreground"
                >{percentLabel(category.bytes, totalBytes)}</span
              >
            </span>
          {/snippet}
          {#snippet actions()}
            {#if target}
              <IconAction
                icon={Eraser}
                label="Free up space"
                disabled={cleanupBlocked}
                onclick={() => freeUp(category)}
              />
            {:else}
              <!-- Keeps sizes aligned with the rows that have an action. -->
              <span class="size-control-sm flex-none" aria-hidden="true"></span>
            {/if}
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
    {#if breakdown.minor.length > 0}
      <Button
        size="sm"
        variant="ghost"
        class="justify-self-start"
        onclick={() => (showSmall = !showSmall)}
        >{showSmall
          ? "Hide smaller items"
          : `Show ${breakdown.minor.length} smaller items`}</Button
      >
    {/if}
  </SettingsSection>

  {#if largest.length > 0}
    <SettingsSection surface={false} title="Largest conversations">
      <PageList ariaLabel="Largest conversations">
        {#each largest as conversation (conversation.conversationId)}
          <PageItem
            title={conversation.title ?? "Untitled conversation"}
            icon={MessageSquare}
            summary={`${percentLabel(conversation.bytes, conversationBytes)} of conversation files`}
            openLabel={`Open ${conversation.title ?? "conversation"}`}
            onOpen={() => void openConversation(conversation.conversationId)}
          >
            {#snippet meta()}
              <span class="text-ui tabular-nums text-foreground"
                >{formatBytes(conversation.bytes)}</span
              >
            {/snippet}
          </PageItem>
        {/each}
      </PageList>
    </SettingsSection>
  {/if}
{/if}

<StorageCleanupDialog
  bind:open={controller.cleanupDialogOpen}
  preset={controller.cleanupPreset}
  usage={controller.usage}
  onStart={(request) => void controller.startCleanup(request)}
/>
