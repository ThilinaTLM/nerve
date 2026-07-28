<script lang="ts">
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import Gauge from "@lucide/svelte/icons/gauge";
import type { ContextUsage } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { formatTokens, usageTone } from "@nervekit/ui-kit/core/utils/usage";
import { PanelSectionHeader } from "@nervekit/workbench-ui/panel";
import type { ConversationRecord } from "$lib/api";

let {
  contextUsage,
  contextWindow = 0,
  activeConversation,
  compacting = false,
  onRequestCompact,
}: {
  contextUsage?: ContextUsage;
  contextWindow?: number;
  activeConversation?: ConversationRecord;
  compacting?: boolean;
  onRequestCompact?: () => void;
} = $props();

const limit = $derived(contextWindow || contextUsage?.contextWindow || 0);
const tokens = $derived(contextUsage?.tokens ?? null);
const percent = $derived(
  tokens != null && limit > 0
    ? (tokens / limit) * 100
    : (contextUsage?.percent ?? null),
);
const hasUsage = $derived(limit > 0 || percent != null);
const clampedPercent = $derived(
  percent == null ? 0 : Math.max(0, Math.min(100, percent)),
);
const percentLabel = $derived(
  percent == null ? "Usage unknown" : `${Math.round(percent)}% used`,
);
const tokensLabel = $derived(
  tokens != null && limit > 0
    ? `${formatTokens(tokens)} / ${formatTokens(limit)} tokens`
    : limit > 0
      ? `${formatTokens(limit)} token window`
      : "",
);
const tone = $derived(usageTone(percent));
const indicatorClass = $derived(
  tone === "error"
    ? "[&_[data-slot=progress-indicator]]:bg-destructive-solid"
    : tone === "warning"
      ? "[&_[data-slot=progress-indicator]]:bg-warning"
      : undefined,
);
const percentClass = $derived(
  tone === "error"
    ? "text-destructive"
    : tone === "warning"
      ? "text-warning"
      : "text-foreground",
);
const compactTitle = $derived(
  activeConversation
    ? compacting
      ? "Conversation compaction is in progress"
      : "Summarize earlier messages to reduce context usage"
    : "Select a conversation to compact its context",
);
</script>

<section class="flex min-w-0 flex-col">
  <PanelSectionHeader title="Context usage" icon={Gauge} />

  <div class="flex min-w-0 flex-col gap-1.5 pt-0.5 pb-1.5">
    {#if hasUsage}
      <div class="flex min-w-0 items-baseline justify-between gap-2 text-xs">
        <span class={`font-medium ${percentClass}`}>{percentLabel}</span>
        {#if tokensLabel}
          <span class="truncate text-muted-foreground">{tokensLabel}</span>
        {/if}
      </div>
      <Progress
        value={clampedPercent}
        class={indicatorClass}
        aria-label="Context window usage"
      />
    {:else}
      <p class="text-xs text-muted-foreground">
        Context usage is available after the first run.
      </p>
    {/if}

    <Button
      size="xs"
      variant="outline"
      class="w-full"
      disabled={!activeConversation || compacting}
      title={compactTitle}
      onclick={() => onRequestCompact?.()}
    >
      <FoldVertical />
      {compacting ? "Compacting…" : "Compact context"}
    </Button>
  </div>
</section>
