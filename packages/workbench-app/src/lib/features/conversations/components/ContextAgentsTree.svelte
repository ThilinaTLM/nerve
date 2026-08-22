<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import Brain from "@lucide/svelte/icons/brain";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Code from "@lucide/svelte/icons/code";
import Eye from "@lucide/svelte/icons/eye";
import Glasses from "@lucide/svelte/icons/glasses";
import HatGlasses from "@lucide/svelte/icons/hat-glasses";
import Shield from "@lucide/svelte/icons/shield";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Telescope from "@lucide/svelte/icons/telescope";
import User from "@lucide/svelte/icons/user";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/core/utils";
import {
  agentActivityPulse,
  agentActivityTone,
  type StatusTone,
} from "@nervekit/ui-kit/core/utils/status";
import {
  PanelEmpty,
  PanelList,
  PanelRow,
  PanelSectionHeader,
} from "$lib/presentation/panel";
import type { AgentRecord } from "$lib/api";
import { shortAgentModel } from "$lib/kernel/utils/project-tree";

let {
  conversationAgents = [],
  activeAgent,
  onSelectAgent,
}: {
  conversationAgents?: AgentRecord[];
  activeAgent?: AgentRecord;
  onSelectAgent?: (agent: AgentRecord) => void;
} = $props();

function isAgentLive(agent: AgentRecord): boolean {
  return agent.status === "running" || agent.status === "awaiting_user";
}

function sortAgents(agents: readonly AgentRecord[]): AgentRecord[] {
  return [...agents].sort((a, b) => {
    const aMain = a.parentAgentId ? 0 : 1;
    const bMain = b.parentAgentId ? 0 : 1;
    if (aMain !== bMain) return bMain - aMain;

    const aSelected = a.id === activeAgent?.id ? 1 : 0;
    const bSelected = b.id === activeAgent?.id ? 1 : 0;
    if (aSelected !== bSelected) return bSelected - aSelected;

    const aLive = isAgentLive(a) ? 1 : 0;
    const bLive = isAgentLive(b) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;

    const aUpdated = new Date(a.updatedAt).getTime();
    const bUpdated = new Date(b.updatedAt).getTime();
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Compact thinking-level suffix rendered next to the model. */
const THINKING_SHORT: Record<string, string> = {
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhi",
  max: "max",
};

function agentModelLabel(agent: AgentRecord): string {
  const model = shortAgentModel(agent);
  const thinking = THINKING_SHORT[agent.thinkingLevel ?? "off"];
  return thinking ? `${model} (${thinking})` : model;
}

/**
 * Second line carries the subagent's task text only; the status dot already
 * conveys the live status, so rows stay single-line without a task.
 */
function agentDescription(agent: AgentRecord): string | undefined {
  return agent.task?.trim() || undefined;
}

type AgentIndicator = {
  icon: typeof Code;
  label: string;
};

const PERMISSION_INDICATORS: Record<string, AgentIndicator["icon"]> = {
  autonomous: ShieldCheck,
  supervised: Shield,
  read_only: Eye,
};

const PERMISSION_LABELS: Record<string, string> = {
  autonomous: "Autonomous",
  supervised: "Supervised",
  read_only: "Read only",
};

function agentIndicators(agent: AgentRecord): AgentIndicator[] {
  const indicators: AgentIndicator[] = [
    {
      icon: agent.parentAgentId ? Bot : User,
      label: agent.parentAgentId ? "Subagent" : "Main agent",
    },
  ];
  if (agent.thinkingLevel && agent.thinkingLevel !== "off") {
    indicators.push({
      icon: Brain,
      label: `Thinking: ${agent.thinkingLevel}`,
    });
  }
  indicators.push({
    icon: agent.mode === "planning" ? ClipboardList : Code,
    label: agent.mode === "planning" ? "Planning mode" : "Coding mode",
  });
  indicators.push({
    icon: PERMISSION_INDICATORS[agent.permissionLevel] ?? Shield,
    label: PERMISSION_LABELS[agent.permissionLevel] ?? agent.permissionLevel,
  });
  return indicators;
}

function agentTooltip(agent: AgentRecord): string {
  const model = agent.model
    ? `${agent.model.provider}/${agent.model.modelId}`
    : "model pending";
  const thinking =
    agent.thinkingLevel && agent.thinkingLevel !== "off"
      ? `thinking: ${agent.thinkingLevel}`
      : undefined;
  return [
    agent.id,
    `status: ${agent.status}`,
    `mode: ${agent.mode} · ${PERMISSION_LABELS[agent.permissionLevel] ?? agent.permissionLevel}`,
    `model: ${model}`,
    thinking,
    agent.task?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Leading status indicator: a role icon tinted by the activity tone. */
function agentStatusIcon(agent: AgentRecord): typeof HatGlasses {
  if (!agent.parentAgentId) return HatGlasses;
  if (agent.permissionLevel === "supervised") return Glasses;
  return Telescope;
}

const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-foreground",
  running: "text-info",
  good: "text-success",
  warn: "text-warning",
  danger: "text-destructive",
};

function agentStatusIconClass(agent: AgentRecord): string {
  return STATUS_TONE_TEXT[agentActivityTone(agent.status, false, agent.mode)];
}

const agents = $derived(sortAgents(conversationAgents));
</script>

{#if conversationAgents.length === 0}
  <PanelEmpty
    icon={Bot}
    title="No agents yet"
    description="Agents appear once a run starts."
  />
{:else}
  <div class="flex min-w-0 flex-col">
    <PanelSectionHeader title="Agents" count={conversationAgents.length} />
    <Tooltip.Provider delayDuration={300}>
      <PanelList ariaLabel="Conversation agents">
        {#each agents as agent (agent.id)}
          {@const StatusIcon = agentStatusIcon(agent)}
          {@const statusColor = agentStatusIconClass(agent)}
          <PanelRow
            label={agentModelLabel(agent)}
            description={agentDescription(agent)}
            title={agentTooltip(agent)}
            class="min-h-6 py-0.5"
            stacked
            onclick={() => onSelectAgent?.(agent)}
          >
            {#snippet leading()}
              <span
                class={cn(
                  "flex shrink-0 items-center",
                  statusColor,
                  agentActivityPulse(agent.status) && "status-pulse",
                )}
                aria-label={agent.parentAgentId
                  ? "Subagent status"
                  : "Main agent status"}
              >
                <StatusIcon class="size-3.5" aria-hidden="true" />
              </span>
            {/snippet}
            {#snippet labelTrailing()}
              <span
                class="flex shrink-0 items-center gap-1 text-muted-foreground"
              >
                {#each agentIndicators(agent) as indicator (indicator.label)}
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <span
                          {...props}
                          class="inline-flex rounded-sm"
                          aria-label={indicator.label}
                        >
                          <indicator.icon class="size-3" aria-hidden="true" />
                        </span>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top">
                      {indicator.label}
                    </Tooltip.Content>
                  </Tooltip.Root>
                {/each}
              </span>
            {/snippet}
          </PanelRow>
        {/each}
      </PanelList>
    </Tooltip.Provider>
  </div>
{/if}
