<script lang="ts">
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import type { ContextUsage } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverProperties,
  PopoverProperty,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import {
  ProgressRing,
  type ProgressRingTone,
} from "@nervekit/ui-kit/components/ui/progress-ring";
import { cn } from "@nervekit/ui-kit/core/utils";
import { formatTokens, usageTone } from "@nervekit/ui-kit/core/utils/usage";
import {
  conversationUsageMetrics,
  emptyConversationUsage,
  type ConversationUsageSummary,
} from "../../usage/conversation-usage.js";

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
const ringTone = $derived<ProgressRingTone>(
  tone === "error" ? "danger" : tone === "warning" ? "warn" : "neutral",
);
const percentLabel = $derived(
  percent == null ? "?%" : `${Math.round(percent)}%`,
);
const usageLabel = $derived(
  percent == null ? "Usage unavailable" : `${percentLabel} used`,
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
const progressClass = $derived(
  tone === "error"
    ? "[&_[data-slot=progress-indicator]]:bg-destructive-solid"
    : tone === "warning"
      ? "[&_[data-slot=progress-indicator]]:bg-warning"
      : "",
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
    size="md"
    triggerClass="composer-tab context-usage-tab"
    ariaLabel="Context usage"
    triggerTitle={title}
    side="top"
    align="end"
    sideOffset={9}
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

    <PopoverBody>
      <PopoverHeader title="Current context window">
        {#snippet action()}
          <span
            class={cn(
              "flex-none text-xs font-medium",
              tone === "error"
                ? "text-destructive"
                : tone === "warning"
                  ? "text-warning"
                  : "text-foreground",
            )}>{usageLabel}</span
          >
        {/snippet}
      </PopoverHeader>

      <PopoverSection>
        <Progress
          value={ringPercent}
          class={cn("h-1", progressClass)}
          aria-label={percent == null
            ? "Context usage unavailable"
            : `${percentLabel} of context window used`}
        />
        {#if percent == null}
          <p class="text-muted-foreground">
            Usage will be available after the next response.
          </p>
        {/if}
      </PopoverSection>

      <PopoverSection separated>
        <PopoverProperties>
          <PopoverProperty
            label="Used"
            value={tokens == null
              ? "Unavailable"
              : `${tokens.toLocaleString()} tokens`}
          />
          <PopoverProperty
            label="Remaining"
            value={remainingTokens == null
              ? "Unavailable"
              : `${remainingTokens.toLocaleString()} tokens`}
          />
          <PopoverProperty
            label="Window"
            value={contextLimit > 0
              ? `${contextLimit.toLocaleString()} tokens`
              : "Unknown"}
          />
        </PopoverProperties>
      </PopoverSection>

      <PopoverSection label="Conversation usage" separated>
        {#if conversationMetrics.hasUsage}
          <PopoverProperties>
            <PopoverProperty
              label="Total processed"
              value={`${conversationMetrics.totalTokens.toLocaleString()} tokens`}
            />
            <PopoverProperty
              label="Prompt input"
              value={`${conversationMetrics.promptTokens.toLocaleString()} tokens`}
            />
            <PopoverProperty
              label="Output"
              value={`${conversationMetrics.output.toLocaleString()} tokens`}
            />
          </PopoverProperties>
        {:else}
          <p class="text-muted-foreground">
            Available after the first response.
          </p>
        {/if}
      </PopoverSection>

      {#if conversationMetrics.hasUsage}
        <PopoverSection label="Prompt cache" separated>
          <PopoverProperties>
            <PopoverProperty
              label="Cached input"
              value={`${conversationMetrics.cachedTokens.toLocaleString()} tokens · ${cacheRateLabel}`}
              title="Provider-reported cache reads as a share of all prompt input"
            />
            <PopoverProperty
              label="Uncached input"
              value={`${conversationMetrics.uncachedTokens.toLocaleString()} tokens`}
            />
            <PopoverProperty
              label="Cache writes"
              value={`${conversationMetrics.cacheWrite.toLocaleString()} tokens`}
            />
          </PopoverProperties>
          <p class="text-muted-foreground">
            Provider-reported usage for the selected branch.
          </p>
        </PopoverSection>
      {/if}

      <Button
        size="xs"
        variant="outline"
        class="w-full"
        disabled={compactActionDisabled}
        title={compacting
          ? "Conversation compaction is in progress"
          : "Summarize earlier messages to reduce context usage"}
        onclick={requestCompact}
      >
        <FoldVertical />
        {compacting ? "Compacting…" : "Compact context"}
      </Button>
    </PopoverBody>
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
