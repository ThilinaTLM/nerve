<script lang="ts">
import { formatTokens } from "@nervekit/ui-kit/core/utils/usage";
import { PanelPropertyRow, PanelSectionHeader } from "$lib/presentation/panel";
import {
  conversationUsageMetrics,
  type ConversationUsageSummary,
} from "$lib/presentation/usage/conversation-usage";

let { conversationUsage }: { conversationUsage: ConversationUsageSummary } =
  $props();

const metrics = $derived(conversationUsageMetrics(conversationUsage));
const cacheRateLabel = $derived(
  metrics.cacheRate == null
    ? "Unavailable"
    : `${Math.round(metrics.cacheRate)}%`,
);

function compactTokens(value: number): string {
  return `${formatTokens(value)} tokens`;
}

function exactTokens(value: number): string {
  return `${value.toLocaleString()} tokens`;
}
</script>

<div class="flex min-w-0 flex-col">
  <PanelSectionHeader title="Conversation usage" />
  {#if metrics.hasUsage}
    <PanelPropertyRow
      label="Processed"
      value={compactTokens(metrics.totalTokens)}
      title={exactTokens(metrics.totalTokens)}
      dense
    />
    <PanelPropertyRow
      label="Prompt input"
      value={compactTokens(metrics.promptTokens)}
      title={exactTokens(metrics.promptTokens)}
      dense
    />
    <PanelPropertyRow
      label="Output"
      value={compactTokens(metrics.output)}
      title={exactTokens(metrics.output)}
      dense
    />
  {:else}
    <p class="py-1.5 text-xs text-muted-foreground">
      Available after the first response.
    </p>
  {/if}
</div>

{#if metrics.hasUsage}
  <div class="flex min-w-0 flex-col">
    <PanelSectionHeader title="Prompt cache">
      {#snippet meta()}{cacheRateLabel}{/snippet}
    </PanelSectionHeader>
    <PanelPropertyRow
      label="Cached input"
      labelClass="w-24"
      value={compactTokens(metrics.cachedTokens)}
      title={`${exactTokens(metrics.cachedTokens)} · ${cacheRateLabel} of prompt input`}
      dense
    />
    <PanelPropertyRow
      label="Uncached input"
      labelClass="w-24"
      value={compactTokens(metrics.uncachedTokens)}
      title={exactTokens(metrics.uncachedTokens)}
      dense
    />
    <PanelPropertyRow
      label="Cache writes"
      labelClass="w-24"
      value={compactTokens(metrics.cacheWrite)}
      title={exactTokens(metrics.cacheWrite)}
      dense
    />
    <p class="pt-1 text-xs text-muted-foreground">
      Provider-reported usage for the selected branch.
    </p>
  </div>
{/if}
