<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import {
  agentActivityPulse,
  agentActivityTone,
} from "@nervekit/ui-kit/core/utils/status";
import {
  PanelEmpty,
  PanelList,
  PanelRow,
  PanelSectionHeader,
} from "@nervekit/workbench-ui/panel";
import type { AgentRecord } from "$lib/api";

let {
  conversationAgents = [],
  activeAgent,
  onSelectAgent,
}: {
  conversationAgents?: AgentRecord[];
  activeAgent?: AgentRecord;
  onSelectAgent?: (agent: AgentRecord) => void;
} = $props();

const mainAgents = $derived(
  conversationAgents.filter((agent) => !agent.parentAgentId),
);
const subagents = $derived(
  conversationAgents.filter((agent) => agent.parentAgentId),
);

function shortAgentId(id: string): string {
  const parts = id.split("_");
  return parts.length > 1 ? (parts.at(-1) ?? id) : id.slice(-6);
}

function isAgentLive(agent: AgentRecord): boolean {
  return agent.status === "running" || agent.status === "awaiting_user";
}

function sortAgents(agents: AgentRecord[]): AgentRecord[] {
  return [...agents].sort((a, b) => {
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

function agentDescription(agent: AgentRecord): string {
  return `${agent.status} · ${agent.mode} · ${agent.permissionLevel}`;
}
</script>

<section class="flex min-w-0 flex-col">
  <PanelSectionHeader
    title="Agents"
    icon={Bot}
    count={conversationAgents.length}
  />

  <div class="flex min-w-0 flex-col pb-1">
    {#if conversationAgents.length === 0}
      <PanelEmpty
        icon={Bot}
        title="No agents yet"
        description="Agents appear once a run starts."
      />
    {:else}
      {#if mainAgents.length > 0}
        <PanelSectionHeader title="Main agent" />
        <PanelList ariaLabel="Main agents">
          {#each sortAgents(mainAgents) as agent (agent.id)}
            <PanelRow
              label={shortAgentId(agent.id)}
              description={agentDescription(agent)}
              title={agent.id}
              mono
              indent={1}
              status={agentActivityTone(agent.status, false, agent.mode)}
              pulse={agentActivityPulse(agent.status)}
              selected={agent.id === activeAgent?.id}
              onclick={() => onSelectAgent?.(agent)}
            />
          {/each}
        </PanelList>
      {/if}

      {#if subagents.length > 0}
        <PanelSectionHeader title="Subagents" count={subagents.length} />
        <PanelList ariaLabel="Subagents">
          {#each sortAgents(subagents) as agent (agent.id)}
            <PanelRow
              label={shortAgentId(agent.id)}
              description={agentDescription(agent)}
              title={agent.id}
              mono
              indent={2}
              status={agentActivityTone(agent.status, false, agent.mode)}
              pulse={agentActivityPulse(agent.status)}
            />
          {/each}
        </PanelList>
      {/if}
    {/if}
  </div>
</section>
