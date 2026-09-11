<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import Glasses from "@lucide/svelte/icons/glasses";
import HatGlasses from "@lucide/svelte/icons/hat-glasses";
import Telescope from "@lucide/svelte/icons/telescope";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  agentActivityPulse,
  agentActivityTone,
  type StatusTone,
} from "@nervekit/ui-kit/display/status";
import {
  PanelEmpty,
  PanelList,
  PanelRow,
  PanelSectionHeader,
} from "$lib/presentation/panels";
import type { AgentRecord } from "$lib/api";
import ContextAgentDetailPopover from "./ContextAgentDetailPopover.svelte";
import {
  agentModelLabel,
  agentRowLabel,
  agentRuleSetId,
  liveAgentCount,
  sortAgents,
  visibleAgents,
} from "./context-agent-rows";

let {
  conversationAgents = [],
  activeAgent,
  onSelectAgent,
}: {
  conversationAgents?: AgentRecord[];
  activeAgent?: AgentRecord;
  onSelectAgent?: (agent: AgentRecord) => void;
} = $props();

let expanded = $state(false);
let openDetailAgentId = $state<string | undefined>(undefined);

/** Leading indicator: a role icon tinted by the activity tone. */
function agentRoleIcon(agent: AgentRecord): typeof HatGlasses {
  if (!agent.parentAgentId) return HatGlasses;
  if (agentRuleSetId(agent) === "supervised") return Glasses;
  return Telescope;
}

const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

function agentRoleIconClass(agent: AgentRecord): string {
  return STATUS_TONE_TEXT[agentActivityTone(agent.status, false, agent.mode)];
}

const sorted = $derived(sortAgents(conversationAgents, activeAgent?.id));
const visible = $derived(
  visibleAgents(sorted, { activeAgentId: activeAgent?.id, expanded }),
);
const liveCount = $derived(liveAgentCount(conversationAgents));
</script>

{#if conversationAgents.length === 0}
  <PanelEmpty
    icon={Bot}
    title="No agents yet"
    description="Agents appear once a run starts."
  />
{:else}
  <div class="flex min-w-0 flex-col">
    <PanelSectionHeader title="Agents" count={conversationAgents.length}>
      {#snippet meta()}
        {#if liveCount > 0}
          <span>{liveCount} live</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        {#if visible.hiddenCount > 0 || expanded}
          <Button
            size="xs"
            variant="ghost"
            onclick={() => (expanded = !expanded)}
          >
            {expanded
              ? "Show fewer"
              : `Show all (${conversationAgents.length})`}
          </Button>
        {/if}
      {/snippet}
    </PanelSectionHeader>
    <PanelList ariaLabel="Conversation agents">
      {#each visible.rows as agent (agent.id)}
        {@const RoleIcon = agentRoleIcon(agent)}
        <PanelRow
          label={agentRowLabel(agent)}
          title={`${agentRowLabel(agent)} · ${agentModelLabel(agent)}`}
          class="min-h-6 py-0.5"
          selected={agent.id === activeAgent?.id}
          alwaysShowActions={openDetailAgentId === agent.id}
          onclick={() => onSelectAgent?.(agent)}
        >
          {#snippet leading()}
            <span
              class={cn(
                "flex shrink-0 items-center",
                agentRoleIconClass(agent),
                agentActivityPulse(agent.status) && "status-pulse",
              )}
              aria-label={agent.parentAgentId
                ? "Subagent status"
                : "Main agent status"}
            >
              <RoleIcon class="size-3.5" aria-hidden="true" />
            </span>
          {/snippet}
          {#snippet badges()}
            <span class="text-muted-foreground tabular-nums"
              >{relativeTimeLabel(agent.updatedAt)}</span
            >
          {/snippet}
          {#snippet actions()}
            <ContextAgentDetailPopover
              {agent}
              bind:open={
                () => openDetailAgentId === agent.id,
                (value) => (openDetailAgentId = value ? agent.id : undefined)
              }
            />
          {/snippet}
        </PanelRow>
      {/each}
    </PanelList>
  </div>
{/if}
