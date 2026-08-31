<script lang="ts">
import { PanelPropertyRow } from "$lib/presentation/panels";
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

function exactTokens(value: number): string {
  return `${value.toLocaleString()} tokens`;
}
</script>

<div class="flex min-w-0 flex-col">
  {#if metrics.hasUsage}
    <PanelPropertyRow
      label="Input"
      labelClass="w-24"
      value={exactTokens(metrics.promptTokens)}
      title={exactTokens(metrics.promptTokens)}
      dense
    />
    <PanelPropertyRow
      label="Cached input"
      labelClass="w-24"
      value={`${exactTokens(metrics.cachedTokens)} · ${cacheRateLabel}`}
      title={`${exactTokens(metrics.cachedTokens)} · ${cacheRateLabel} of all input tokens`}
      dense
    />
    <PanelPropertyRow
      label="Output"
      labelClass="w-24"
      value={exactTokens(metrics.output)}
      title={exactTokens(metrics.output)}
      dense
    />
  {:else}
    <p class="py-1.5 text-xs text-muted-foreground">
      Available after the first response.
    </p>
  {/if}
</div>
