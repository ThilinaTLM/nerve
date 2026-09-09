<script lang="ts">
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import type { ContextUsage } from "@nervekit/contracts/models";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import Popover, {
  PopoverBody,
  PopoverFooter,
  PopoverHeader,
  PopoverMeter,
  PopoverProperties,
  PopoverProperty,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { ProgressRing } from "@nervekit/ui-kit/components/composites/progress-ring";
import { formatTokens, usageTone } from "@nervekit/ui-kit/display/usage";
import {
  conversationUsageMetrics,
  emptyConversationUsage,
  type ConversationUsageSummary,
} from "../usage/conversation-usage.js";

type Props = {
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  contextWindow?: number;
  compacting?: boolean;
  compactDisabled?: boolean;
  onCompact?: () => void;
};

let {
  contextUsage,
  conversationUsage,
  contextWindow = 0,
  compacting = false,
  compactDisabled = false,
  onCompact,
}: Props = $props();

let open = $state(false);
let confirmCompactOpen = $state(false);

const contextLimit = $derived(
  contextWindow || contextUsage?.contextWindow || 0,
);
const tokens = $derived(contextUsage?.tokens ?? null);
const conversationMetrics = $derived(
  conversationUsageMetrics(conversationUsage ?? emptyConversationUsage()),
);
const cacheRateLabel = $derived(
  conversationMetrics.cacheRate == null
    ? "Unavailable"
    : `${Math.round(conversationMetrics.cacheRate)}%`,
);
const percent = $derived.by(() => {
  if (tokens != null && contextLimit > 0) {
    return (tokens / contextLimit) * 100;
  }
  return contextUsage?.percent ?? null;
});
const ringPercent = $derived(
  percent == null ? 0 : Math.max(0, Math.min(100, percent)),
);
const remainingTokens = $derived(
  tokens != null && contextLimit > 0
    ? Math.max(0, contextLimit - tokens)
    : null,
);
const tone = $derived(usageTone(percent));
const ringTone = $derived<StatusTone>(
  tone === "error" ? "destructive" : tone === "warning" ? "warning" : "neutral",
);
const percentLabel = $derived(
  percent == null ? "?%" : `${Math.round(percent)}%`,
);
const title = $derived.by(() => {
  if (tokens != null && contextLimit > 0) {
    return `Context: ${tokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens`;
  }
  if (contextLimit > 0) {
    return `Context usage unknown / ${contextLimit.toLocaleString()} tokens`;
  }
  return "Context window unknown";
});
const windowLabel = $derived(
  contextLimit > 0 ? formatTokens(contextLimit) : "—",
);
const compactActionDisabled = $derived(
  compacting || compactDisabled || !onCompact,
);
const meterTone = $derived<"accent" | "warning" | "destructive">(
  tone === "error" ? "destructive" : tone === "warning" ? "warning" : "accent",
);

function requestCompact(): void {
  if (compactActionDisabled) return;
  open = false;
  confirmCompactOpen = true;
}
</script>

{#if contextLimit > 0 || percent != null}
  <Popover
    bind:open
    size="sm"
    triggerClass="composer-tab context-usage-tab"
    ariaLabel="Context usage"
    triggerTitle={title}
    side="top"
    align="end"
  >
    {#snippet trigger()}
      <span
        class="context-usage-tab-inner inline-flex items-center gap-1"
        data-tone={tone}
        data-tour-id="composer-context"
      >
        <ProgressRing percent={ringPercent} tone={ringTone} />
        <span class="ctx-percent">{percentLabel}</span>
        <span class="ctx-window font-medium text-muted-foreground"
          >/{windowLabel}</span
        >
      </span>
    {/snippet}

    <PopoverHeader title="Context" />

    <PopoverBody>
      <PopoverMeter
        label="Used"
        value={tokens == null
          ? "—"
          : `${formatTokens(tokens)} / ${formatTokens(contextLimit)}`}
        percent={percent ?? undefined}
        tone={meterTone}
        caption={percent == null
          ? `Available after the next response · ${windowLabel} window`
          : `${percentLabel} used · ${
              remainingTokens == null
                ? "remaining unknown"
                : `${formatTokens(remainingTokens)} remaining`
            }`}
      />

      <PopoverSection label="Token usage" separated>
        {#if conversationMetrics.hasUsage}
          <PopoverProperties>
            <PopoverProperty
              label="Input"
              value={`${formatTokens(conversationMetrics.promptTokens)} tokens`}
              title={`${conversationMetrics.promptTokens.toLocaleString()} tokens`}
            />
            <PopoverProperty
              label="Cached input"
              value={`${formatTokens(conversationMetrics.cachedTokens)} tokens · ${cacheRateLabel}`}
              title={`${conversationMetrics.cachedTokens.toLocaleString()} tokens · ${cacheRateLabel} of all input tokens`}
            />
            <PopoverProperty
              label="Output"
              value={`${formatTokens(conversationMetrics.output)} tokens`}
              title={`${conversationMetrics.output.toLocaleString()} tokens`}
            />
          </PopoverProperties>
        {:else}
          <p class="px-1.5 text-muted-foreground">
            Available after the first response.
          </p>
        {/if}
      </PopoverSection>
    </PopoverBody>

    <PopoverFooter>
      <Button
        size="xs"
        variant="ghost"
        disabled={compactActionDisabled}
        title={compacting
          ? "Conversation compaction is in progress"
          : "Summarize earlier messages to reduce context usage"}
        onclick={requestCompact}
      >
        <FoldVertical />
        {compacting ? "Compacting…" : "Compact context"}
      </Button>
    </PopoverFooter>
  </Popover>
{/if}

<ConfirmDialog
  bind:open={confirmCompactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact context"
  onConfirm={() => onCompact?.()}
/>

<style>
.context-usage-tab-inner[data-tone="warning"] .ctx-percent {
  color: var(--warning);
}

.context-usage-tab-inner[data-tone="error"] .ctx-percent {
  color: var(--destructive);
}

@media (max-width: 639px) {
  .ctx-window {
    display: none;
  }
}
</style>
