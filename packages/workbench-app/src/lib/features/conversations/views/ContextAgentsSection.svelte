<script lang="ts">
import Binoculars from "@lucide/svelte/icons/binoculars";
import Bot from "@lucide/svelte/icons/bot";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Crown from "@lucide/svelte/icons/crown";
import Hammer from "@lucide/svelte/icons/hammer";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { cn } from "@nervekit/ui-kit/utils";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  PanelEmpty,
  PanelList,
  PanelRow,
  PanelSectionHeader,
} from "$lib/presentation/panels";
import type { AgentRecord } from "$lib/api";
import ContextAgentDetailPopover from "./ContextAgentDetailPopover.svelte";
import {
  agentAttention,
  agentModelLabel,
  agentRole,
  agentRowLabel,
  agentStatusBadge,
  exploreFoldSummary,
  groupAgents,
  type AgentRole,
} from "./context-agent-rows";

let {
  conversationAgents = [],
  activeAgent,
  onSelectAgent,
  onOpenTranscript,
}: {
  conversationAgents?: AgentRecord[];
  activeAgent?: AgentRecord;
  onSelectAgent?: (agent: AgentRecord) => void;
  /** Subagent rows open their live transcript instead of selecting the agent. */
  onOpenTranscript?: (agent: AgentRecord) => void;
} = $props();

/** Folded explore history shows at most this many status squares. */
const FOLD_STRIP_LIMIT = 8;

const ROLE_ICON: Record<AgentRole, typeof Crown> = {
  lead: Crown,
  teammate: Hammer,
  explore: Binoculars,
};

let openDetailAgentId = $state<string | undefined>(undefined);
let exploreOpen = $state(false);

const groups = $derived(groupAgents(conversationAgents, activeAgent?.id));
const attention = $derived(agentAttention(conversationAgents));
const foldSummary = $derived(exploreFoldSummary(groups.exploreDone));
const exploreCount = $derived(
  groups.exploreLive.length + groups.exploreDone.length,
);

function activateRow(agent: AgentRecord) {
  if (agent.parentAgentId) onOpenTranscript?.(agent);
  else onSelectAgent?.(agent);
}

function rowTitle(agent: AgentRecord): string {
  const base = `${agentRowLabel(agent)} · ${agentModelLabel(agent)}`;
  return agent.parentAgentId ? `${base} · Open transcript` : base;
}

function statusDotClass(agent: AgentRecord): string | undefined {
  if (agent.status === "running") return "bg-info status-pulse";
  if (agent.status === "awaiting_user") return "bg-warning";
  if (agent.status === "error") return "bg-destructive";
  return undefined;
}

function idleLabel(agent: AgentRecord): string {
  const time = relativeTimeLabel(agent.updatedAt);
  return agentRole(agent) === "teammate" ? `idle · ${time}` : time;
}
</script>

{#snippet agentRow(agent: AgentRecord)}
  {@const RoleIcon = ROLE_ICON[agentRole(agent)]}
  {@const badge = agentStatusBadge(agent)}
  {@const dot = statusDotClass(agent)}
  <PanelRow
    label={agentRowLabel(agent)}
    title={rowTitle(agent)}
    class="min-h-6 py-0.5"
    selected={agent.id === activeAgent?.id}
    alwaysShowActions={openDetailAgentId === agent.id}
    onclick={() => activateRow(agent)}
  >
    {#snippet leading()}
      <span
        class={cn(
          "relative flex shrink-0 items-center",
          agentRole(agent) === "lead" && "text-primary",
        )}
      >
        <RoleIcon class="size-3.5" aria-hidden="true" />
        {#if dot}
          <span
            class={cn(
              "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-card",
              dot,
            )}
            aria-hidden="true"
          ></span>
        {/if}
      </span>
    {/snippet}
    {#snippet badges()}
      {#if badge}
        <Badge variant={badge.variant}>{badge.text}</Badge>
      {:else}
        <span class="text-muted-foreground tabular-nums"
          >{idleLabel(agent)}</span
        >
      {/if}
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
{/snippet}

{#snippet groupHeader(title: string, count: number)}
  <div class="flex items-baseline gap-1 px-2 pt-3 pb-0.5 text-xs">
    <span class="font-semibold text-foreground">{title}</span>
    <span class="text-muted-foreground tabular-nums">{count}</span>
  </div>
{/snippet}

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
        {#if attention.needsYou > 0}
          <span class="text-warning">{attention.needsYou} needs you</span>
        {/if}
        {#if attention.needsYou > 0 && attention.working > 0}
          <span aria-hidden="true">·</span>
        {/if}
        {#if attention.working > 0}
          <span class="text-info">{attention.working} working</span>
        {/if}
      {/snippet}
    </PanelSectionHeader>

    {#if groups.lead}
      <PanelList ariaLabel="Lead agent">
        {@render agentRow(groups.lead)}
      </PanelList>
    {/if}

    {#if groups.teammates.length > 0}
      {@render groupHeader("Teammates", groups.teammates.length)}
      <PanelList ariaLabel="Teammates">
        {#each groups.teammates as agent (agent.id)}
          {@render agentRow(agent)}
        {/each}
      </PanelList>
    {/if}

    {#if exploreCount > 0}
      {@render groupHeader("Explore", exploreCount)}
      <PanelList ariaLabel="Explore agents">
        {#each groups.exploreLive as agent (agent.id)}
          {@render agentRow(agent)}
        {/each}
        {#if groups.exploreDone.length > 0}
          <PanelRow
            label={foldSummary.label}
            class="min-h-6 py-0.5"
            ariaExpanded={exploreOpen}
            onclick={() => (exploreOpen = !exploreOpen)}
          >
            {#snippet leading()}
              <ChevronRight
                class={cn(
                  "size-3.5 transition-transform",
                  exploreOpen && "rotate-90",
                )}
                aria-hidden="true"
              />
            {/snippet}
            {#snippet badges()}
              <span class="flex items-center gap-0.5" aria-hidden="true">
                {#each groups.exploreDone.slice(0, FOLD_STRIP_LIMIT) as agent (agent.id)}
                  <span
                    class={cn(
                      "size-1.5 rounded-[2px]",
                      agent.status === "error" || agent.status === "aborted"
                        ? "bg-destructive"
                        : "bg-success",
                    )}
                  ></span>
                {/each}
              </span>
            {/snippet}
          </PanelRow>
          {#if exploreOpen}
            {#each groups.exploreDone as agent (agent.id)}
              {@render agentRow(agent)}
            {/each}
          {/if}
        {/if}
      </PanelList>
    {/if}
  </div>
{/if}
