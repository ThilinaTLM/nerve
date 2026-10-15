<script lang="ts">
import { untrack, type Snippet } from "svelte";
import Clipboard from "@lucide/svelte/icons/clipboard";
import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
import FileText from "@lucide/svelte/icons/file-text";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import type { ConversationAgentUsage } from "@nervekit/contracts/core";
import type { ContextUsage } from "@nervekit/contracts/models";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
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
  sessionFieldsText,
  type ConversationSessionInfo,
} from "./session-info";
import {
  conversationUsageMetrics,
  emptyConversationUsage,
  type ConversationUsageMetrics,
  type ConversationUsageSummary,
} from "../usage/conversation-usage.js";

type Props = {
  session?: ConversationSessionInfo;
  /** Conversation-level icon actions, rendered in the header after the
   * session-details button. */
  contextActions?: Snippet<[closePopover: () => void]>;
  contextUsage?: ContextUsage;
  conversationUsage?: ConversationUsageSummary;
  contextWindow?: number;
  compacting?: boolean;
  compactDisabled?: boolean;
  onCompact?: () => void;
  /** Prepares and opens the next-request system prompt using current settings. */
  onOpenSystemPrompt?: () => void | Promise<void>;
  /** Cumulative recorded response usage for this conversation and its
   * sub-agents. Replaces `conversationUsage` when the owner supplies it. */
  agentUsage?: ConversationAgentUsage;
  agentUsageLoading?: boolean;
  agentUsageError?: string;
  /** Notifies the owner so aggregate usage is fetched only while open. */
  onUsageOpenChange?: (open: boolean) => void;
  onUsageRetry?: () => void;
};

let {
  session,
  contextActions,
  contextUsage,
  conversationUsage,
  contextWindow = 0,
  compacting = false,
  compactDisabled = false,
  onCompact,
  onOpenSystemPrompt,
  agentUsage,
  agentUsageLoading = false,
  agentUsageError,
  onUsageOpenChange,
  onUsageRetry,
}: Props = $props();

let open = $state(false);
let confirmCompactOpen = $state(false);
let systemPromptBusy = $state(false);
let sessionCopied = $state(false);
let sessionCopiedTimer: ReturnType<typeof setTimeout> | undefined;
$effect(() => () => clearTimeout(sessionCopiedTimer));

function copySession(): void {
  if (!session) return;
  session.onCopy?.(sessionFieldsText(session.fields), "session details");
  sessionCopied = true;
  clearTimeout(sessionCopiedTimer);
  sessionCopiedTimer = setTimeout(() => (sessionCopied = false), 1200);
}

const contextLimit = $derived(
  contextWindow || contextUsage?.contextWindow || 0,
);
const tokens = $derived(contextUsage?.tokens ?? null);
const conversationMetrics = $derived(
  conversationUsageMetrics(conversationUsage ?? emptyConversationUsage()),
);
let reportedOpen = false;
$effect(() => {
  const next = open;
  if (next === reportedOpen) return;
  reportedOpen = next;
  untrack(() => onUsageOpenChange?.(next));
});

$effect(() => () => {
  if (!reportedOpen) return;
  reportedOpen = false;
  untrack(() => onUsageOpenChange?.(false));
});

const ownMetrics = $derived(
  conversationUsageMetrics(agentUsage?.own ?? emptyConversationUsage()),
);
const subagentMetrics = $derived(
  conversationUsageMetrics(agentUsage?.subagents ?? emptyConversationUsage()),
);
const totalMetrics = $derived(
  conversationUsageMetrics(agentUsage?.total ?? emptyConversationUsage()),
);
const subagentCount = $derived(agentUsage?.subagentCount ?? 0);
const totalTokenCount = $derived(
  totalMetrics.promptTokens + totalMetrics.output,
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

async function openSystemPrompt(): Promise<void> {
  if (!onOpenSystemPrompt || systemPromptBusy) return;
  systemPromptBusy = true;
  try {
    await onOpenSystemPrompt();
  } finally {
    systemPromptBusy = false;
  }
}

function requestCompact(): void {
  if (compactActionDisabled) return;
  open = false;
  confirmCompactOpen = true;
}
</script>

{#snippet usageRows(m: ConversationUsageMetrics, total: number | null = null)}
  {@const rate =
    m.cacheRate == null ? "Unavailable" : `${Math.round(m.cacheRate)}%`}
  <PopoverProperties>
    <PopoverProperty
      label="Input"
      value={`${formatTokens(m.promptTokens)} tokens`}
      title={`${m.promptTokens.toLocaleString()} tokens`}
    />
    <PopoverProperty
      label="Cached input"
      value={`${formatTokens(m.cachedTokens)} tokens · ${rate}`}
      title={`${m.cachedTokens.toLocaleString()} tokens · ${rate} of all input tokens`}
    />
    <PopoverProperty
      label="Output"
      value={`${formatTokens(m.output)} tokens`}
      title={`${m.output.toLocaleString()} tokens`}
    />
    {#if total != null}
      <PopoverProperty
        label="Total tokens"
        value={`${formatTokens(total)} tokens`}
        title={`${total.toLocaleString()} tokens (input including cache + output)`}
      />
    {/if}
  </PopoverProperties>
{/snippet}

{#snippet staleNotice()}
  <div class="flex items-center gap-2 px-1.5 pb-1" role="status">
    <p class="text-warning">Refresh failed; showing earlier totals.</p>
    {#if onUsageRetry}
      <Button size="sm" variant="ghost" onclick={onUsageRetry}>Retry</Button>
    {/if}
  </div>
{/snippet}

{#if onOpenSystemPrompt || contextLimit > 0 || percent != null}
  <Popover
    bind:open
    size="md"
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

    <PopoverHeader title="Context">
      {#snippet actions()}
        {#if session}
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root ignoreNonKeyboardFocus>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <span {...props} class="inline-flex">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-foreground"
                      ariaLabel="Copy session details"
                      onclick={copySession}
                    >
                      {#if sessionCopied}
                        <ClipboardCheck
                          class="size-3.5 text-success"
                          aria-hidden="true"
                        />
                      {:else}
                        <Clipboard class="size-3.5" aria-hidden="true" />
                      {/if}
                    </Button>
                  </span>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content
                side="top"
                class="max-w-md flex-col items-stretch gap-1 py-2"
              >
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                  {#each session.fields as field (field.label)}
                    <dt class="text-muted-foreground">{field.label}</dt>
                    <dd
                      class={[
                        "text-right break-all",
                        field.mono && "font-mono",
                      ]}
                    >
                      {field.value ?? "—"}
                    </dd>
                  {/each}
                </dl>
                <p class="border-t pt-1 text-muted-foreground">
                  Click to copy all session details
                </p>
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        {/if}
        {#if onOpenSystemPrompt}
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root ignoreNonKeyboardFocus>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <span {...props} class="inline-flex">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-foreground"
                      ariaLabel="Open system prompt"
                      disabled={systemPromptBusy}
                      onclick={() => void openSystemPrompt()}
                    >
                      {#if systemPromptBusy}
                        <Spinner class="size-3.5" />
                      {:else}
                        <FileText class="size-3.5" aria-hidden="true" />
                      {/if}
                    </Button>
                  </span>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="top" class="max-w-xs">
                Open the system prompt for the next request using current
                settings. Changes before sending may change it.
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        {/if}
        {@render contextActions?.(() => (open = false))}
      {/snippet}
    </PopoverHeader>

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

      {#if agentUsage && subagentCount > 0}
        <PopoverSection label="This agent" separated>
          {#if agentUsageError}
            {@render staleNotice()}
          {/if}
          {#if ownMetrics.hasUsage}
            {@render usageRows(ownMetrics)}
          {:else}
            <p class="px-1.5 text-muted-foreground">
              Available after the first response.
            </p>
          {/if}
        </PopoverSection>
        <PopoverSection label={`Sub-agents (${subagentCount})`} separated>
          {#if subagentMetrics.hasUsage}
            {@render usageRows(subagentMetrics)}
          {:else}
            <p class="px-1.5 text-muted-foreground">No responses yet.</p>
          {/if}
        </PopoverSection>
        <PopoverSection label="All agents" separated>
          {@render usageRows(totalMetrics, totalTokenCount)}
          <p class="px-1.5 pt-1 text-muted-foreground">
            Cumulative recorded response tokens, not combined context window
            usage.
          </p>
        </PopoverSection>
      {:else}
        <PopoverSection label="Token usage" separated>
          {#if agentUsage}
            {#if agentUsageError}
              {@render staleNotice()}
            {/if}
            {#if ownMetrics.hasUsage}
              {@render usageRows(ownMetrics)}
            {:else}
              <p class="px-1.5 text-muted-foreground">
                Available after the first response.
              </p>
            {/if}
          {:else if onUsageOpenChange}
            {#if agentUsageError}
              <div class="flex items-center gap-2 px-1.5">
                <p class="text-destructive">Token usage unavailable.</p>
                {#if onUsageRetry}
                  <Button size="sm" variant="ghost" onclick={onUsageRetry}>
                    Retry
                  </Button>
                {/if}
              </div>
            {:else}
              <p class="px-1.5 text-muted-foreground" role="status">
                {agentUsageLoading ? "Loading…" : "Available when opened."}
              </p>
            {/if}
          {:else if conversationMetrics.hasUsage}
            {@render usageRows(conversationMetrics)}
          {:else}
            <p class="px-1.5 text-muted-foreground">
              Available after the first response.
            </p>
          {/if}
        </PopoverSection>
      {/if}
    </PopoverBody>

    <PopoverFooter>
      <Button
        size="sm"
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
