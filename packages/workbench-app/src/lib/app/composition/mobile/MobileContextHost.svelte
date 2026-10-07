<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import FileDown from "@lucide/svelte/icons/file-down";
import FileText from "@lucide/svelte/icons/file-text";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { AgentRecord } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { formatTokens, usageTone } from "@nervekit/ui-kit/display/usage";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { conversationUsageMetrics } from "$lib/presentation/usage/conversation-usage";
import { setConversationUiCapabilities } from "$lib/presentation/context.svelte";
import SubagentTranscriptDialog from "$lib/presentation/tools/tool-call/SubagentTranscriptDialog.svelte";
import {
  compactActiveConversation,
  conversationSelectors,
} from "$lib/features/conversations";
import { selectConversationAgent } from "$lib/features/conversations/state/agent-selection.svelte";
import {
  agentModelLabel,
  agentRowLabel,
} from "$lib/features/conversations/views/context-agent-rows";
import {
  exportUrl,
  systemPromptUrl,
  workspaceSelectors,
} from "$lib/application/workspace";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import { workbenchConversationUiCapabilities } from "../conversations/conversation-capabilities.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/**
 * Conversation context on a phone: how full the window is, what it cost, which
 * agents are working, and a way into the project's changes. Route activation
 * makes this conversation the active one, which the selectors read.
 */
let { route }: MobileScreenProps<"context"> = $props();

// The transcript dialog renders tool cards that read conversation capabilities.
setConversationUiCapabilities(workbenchConversationUiCapabilities());

const conversation = $derived(
  conversationSelectors.activeConversation?.id === route.conversationId
    ? conversationSelectors.activeConversation
    : undefined,
);
const contextUsage = $derived(conversationSelectors.activeContextUsage);
const contextWindow = $derived(
  conversationSelectors.activeContextWindow || contextUsage?.contextWindow || 0,
);
const tokens = $derived(contextUsage?.tokens ?? null);
const percent = $derived(
  tokens != null && contextWindow > 0
    ? (tokens / contextWindow) * 100
    : (contextUsage?.percent ?? null),
);
const tone = $derived(usageTone(percent));
const usageLabel = $derived(
  tokens != null && contextWindow > 0
    ? `${formatTokens(tokens)} of ${formatTokens(contextWindow)} tokens`
    : contextWindow > 0
      ? `${formatTokens(contextWindow)} token window`
      : "Usage unknown",
);
const metrics = $derived(
  conversationUsageMetrics(conversationSelectors.activeConversationUsage),
);
const agents = $derived(
  conversationSelectors.conversationAgents.filter(
    (agent: AgentRecord) => agent.conversationId === route.conversationId,
  ),
);
const agentActivities = $derived(workspaceSelectors.agentActivities);
const compacting = $derived(conversationSelectors.compacting);

let compactOpen = $state(false);
let transcriptAgent = $state<AgentRecord>();
let transcriptOpen = $state(false);

function agentTone(agent: AgentRecord): StatusTone {
  switch (agentActivities[agent.id]?.state) {
    case "running":
      return "info";
    case "awaiting_user":
    case "awaiting_async":
      return "warning";
    case "error":
    case "aborted":
      return "destructive";
    default:
      return "neutral";
  }
}

async function selectAgent(agent: AgentRecord) {
  await selectConversationAgent(agent);
  backFromMobileScreen();
}

function openTranscript(agent: AgentRecord) {
  if (!agent.parentAgentId) return;
  transcriptAgent = agent;
  transcriptOpen = true;
}

function openUrl(url: string | undefined) {
  if (url) window.open(url, "_blank", "noopener");
}

function tokensLabel(value: number): string {
  return `${value.toLocaleString()} tokens`;
}
</script>

<MobileScreen
  title="Context"
  subtitle={conversation?.title}
  onBack={backFromMobileScreen}
  backLabel="Back to conversation"
>
  <MobileSection title="Context window">
    <div class="grid gap-2 px-4 py-3">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm text-foreground">{usageLabel}</span>
        <span
          class={tone === "error"
            ? "text-sm font-medium text-destructive"
            : tone === "warning"
              ? "text-sm font-medium text-warning"
              : "text-sm font-medium text-muted-foreground"}
          >{percent == null ? "—" : `${Math.round(percent)}%`}</span
        >
      </div>
      <Progress value={Math.max(0, Math.min(100, percent ?? 0))} />
      <Button
        variant="outline"
        size="sm"
        class="justify-self-start"
        disabled={!conversation || compacting}
        onclick={() => (compactOpen = true)}
      >
        <FoldVertical />
        {compacting ? "Compacting…" : "Compact"}
      </Button>
    </div>
  </MobileSection>

  <MobileSection title="Usage">
    {#if metrics.hasUsage}
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
        <dt class="text-muted-foreground">Input</dt>
        <dd class="text-right">{tokensLabel(metrics.promptTokens)}</dd>
        <dt class="text-muted-foreground">Cached</dt>
        <dd class="text-right">
          {tokensLabel(metrics.cachedTokens)}{metrics.cacheRate == null
            ? ""
            : ` · ${Math.round(metrics.cacheRate)}%`}
        </dd>
        <dt class="text-muted-foreground">Output</dt>
        <dd class="text-right">{tokensLabel(metrics.output)}</dd>
        {#if metrics.cost > 0}
          <dt class="text-muted-foreground">Cost</dt>
          <dd class="text-right">${metrics.cost.toFixed(2)}</dd>
        {/if}
      </dl>
    {:else}
      <p class="px-4 py-3 text-sm text-muted-foreground">
        Available after the first response.
      </p>
    {/if}
  </MobileSection>

  {#if agents.length}
    <MobileSection title="Agents" meta={`${agents.length}`}>
      {#each agents as agent (agent.id)}
        <MobileListRow
          title={agentRowLabel(agent)}
          detail={agentModelLabel(agent)}
          tone={agentTone(agent)}
          pulse={agentActivities[agent.id]?.state === "running"}
          selected={conversationSelectors.activeAgent?.id === agent.id}
          menuItems={agent.parentAgentId
            ? [
                {
                  label: "View transcript",
                  onSelect: () => openTranscript(agent),
                },
              ]
            : undefined}
          onclick={() => void selectAgent(agent)}
        >
          {#snippet leading()}
            <Bot class="mt-0.5 size-4 flex-none text-muted-foreground" />
          {/snippet}
        </MobileListRow>
      {/each}
    </MobileSection>
  {/if}

  <MobileSection title="Project">
    {#if conversation}
      <MobileListRow
        title="Git changes"
        detail="Review what changed in the working tree"
        icon={GitBranch}
        onclick={() =>
          pushMobileScreen({ kind: "git", projectId: conversation.projectId })}
      />
    {/if}
    <MobileListRow
      title="Export as Markdown"
      icon={FileDown}
      chevron={false}
      onclick={() => openUrl(exportUrl("md"))}
    />
    <MobileListRow
      title="System prompt"
      icon={FileText}
      chevron={false}
      onclick={() => openUrl(systemPromptUrl())}
    />
  </MobileSection>
</MobileScreen>

<ConfirmDialog
  bind:open={compactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact context"
  onConfirm={() => void compactActiveConversation()}
/>

{#if transcriptAgent}
  <SubagentTranscriptDialog
    bind:open={transcriptOpen}
    parentAgentId={transcriptAgent.parentAgentId}
    childAgentId={transcriptAgent.id}
    label={agentRowLabel(transcriptAgent)}
  />
{/if}
