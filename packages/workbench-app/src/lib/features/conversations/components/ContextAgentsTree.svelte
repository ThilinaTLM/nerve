<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import {
  agentActivityPulse,
  agentActivityTone,
} from "@nervekit/ui-kit/core/utils/status";
import { PanelEmpty, PanelList, PanelRow } from "$lib/presentation/panel";
import type { AgentRecord } from "$lib/api";
import { shortAgentModel } from "$lib/core/utils/project-tree";
import { permissionLabel } from "./context-session-fields";

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

function agentDescription(agent: AgentRecord): string {
  return `${agent.mode} · ${permissionLabel(agent.permissionLevel)}`;
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
    `mode: ${agent.mode} · ${permissionLabel(agent.permissionLevel)}`,
    `model: ${model}`,
    thinking,
  ]
    .filter(Boolean)
    .join("\n");
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
  <PanelList ariaLabel="Conversation agents">
    {#each agents as agent, index (agent.id)}
      <PanelRow
        label={agentModelLabel(agent)}
        description={agentDescription(agent)}
        title={agentTooltip(agent)}
        status={agentActivityTone(agent.status, false, agent.mode)}
        pulse={agentActivityPulse(agent.status)}
        class={agent.parentAgentId && !agents[index - 1]?.parentAgentId
          ? "mt-2"
          : undefined}
        dense
        onclick={() => onSelectAgent?.(agent)}
      />
    {/each}
  </PanelList>
{/if}
