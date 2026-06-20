<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Download from "@lucide/svelte/icons/download";
  import Layers from "@lucide/svelte/icons/layers";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import type {
    AgentRecord,
    ProjectRecord,
    ConversationRecord,
    StatusResponse,
  } from "$lib/api";
  import { agentActivityPulse, agentActivityTone } from "$lib/core/utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import PanelSection from "$lib/app/layout/utility/PanelSection.svelte";

  type Props = {
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
    conversationAgents?: AgentRecord[];
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    systemPromptUrl?: () => string | undefined;
    onSelectAgent?: (agent: AgentRecord) => void;
  };

  let {
    status,
    activeProject,
    activeConversation,
    activeAgent,
    conversationAgents = [],
    exportUrl,
    systemPromptUrl,
    onSelectAgent,
  }: Props = $props();

  const systemPromptHref = $derived(systemPromptUrl?.());

  let activeContextOpen = $state(true);
  let agentsOpen = $state(true);
  let exportOpen = $state(true);

  const fields = $derived([
    { label: "Project", value: activeProject?.name },
    { label: "Directory", value: activeProject?.dir },
    { label: "Conversation", value: activeConversation?.id },
    { label: "Agent", value: activeAgent?.id },
    { label: "Daemon", value: status?.daemonId },
    { label: "Data", value: status?.dataDir },
  ]);

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

      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();
      return bCreated - aCreated;
    });
  }

  let subagentsOpen = $state(false);
  $effect(() => {
    if (subagents.some(isAgentLive)) {
      subagentsOpen = true;
    }
  });
</script>

<div class="flex flex-col gap-2 p-2">
  <PanelSection title="Active Context" icon={Layers} bind:open={activeContextOpen}>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      {#each fields as field}
        <dt class="font-mono text-xs text-muted-foreground">{field.label}</dt>
        <dd class="truncate font-mono text-xs text-foreground" title={field.value}>
          {field.value ?? "—"}
        </dd>
      {/each}
    </dl>
  </PanelSection>

  <PanelSection title="Agents" icon={Bot} bind:open={agentsOpen}>
    <div class="-mx-3 -my-2.5 flex flex-col">
      {#if conversationAgents.length === 0}
        <p class="px-3 py-2.5 text-xs text-muted-foreground">No agents in the active conversation.</p>
      {/if}

      {#if mainAgents.length > 0}
        <div class="px-3 pt-2.5 pb-1">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Main agent</h4>
        </div>
        {#each sortAgents(mainAgents) as agent (agent.id)}
          <button
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60 {agent.id === activeAgent?.id ? 'bg-muted/60' : ''}"
            type="button"
            title={agent.id}
            onclick={() => onSelectAgent?.(agent)}
          >
            <StatusDot
              tone={agentActivityTone(agent.status)}
              pulse={agentActivityPulse(agent.status)}
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 truncate text-xs text-foreground">
                <span>Main agent</span>
                <span class="font-mono text-xs text-muted-foreground">{shortAgentId(agent.id)}</span>
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {agent.status} · {agent.mode} · {agent.permissionLevel}
              </div>
            </div>
          </button>
        {/each}
      {/if}

      {#if subagents.length > 0}
        <button
          class="flex w-full items-center gap-1 px-3 pt-2.5 pb-1 text-left"
          type="button"
          onclick={() => (subagentsOpen = !subagentsOpen)}
        >
          {#if subagentsOpen}
            <ChevronDown size={13} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
          {:else}
            <ChevronRight size={13} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
          {/if}
          <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subagents</h4>
          <span class="text-xs text-muted-foreground">· {subagents.length}</span>
        </button>
        {#if subagentsOpen}
          {#each sortAgents(subagents) as agent (agent.id)}
            <button
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60 {agent.id === activeAgent?.id ? 'bg-muted/60' : ''}"
              type="button"
              title={agent.id}
              onclick={() => onSelectAgent?.(agent)}
            >
              <StatusDot
                tone={agentActivityTone(agent.status)}
                pulse={agentActivityPulse(agent.status)}
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 truncate text-xs text-foreground">
                  <span>Subagent</span>
                  <span class="font-mono text-xs text-muted-foreground">{shortAgentId(agent.id)}</span>
                </div>
                <div class="truncate text-xs text-muted-foreground">
                  {agent.status} · {agent.mode} · {agent.permissionLevel}
                </div>
              </div>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  </PanelSection>

  {#if activeConversation}
    <PanelSection title="Export" icon={Download} bind:open={exportOpen}>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</span>
          <div class="flex flex-wrap gap-1.5">
            <Badge
              href={exportUrl?.("json")}
              download={`conversation-${activeConversation.id}.json`}
              variant="outline"
              size="sm"
            >JSON</Badge>
            <Badge
              href={exportUrl?.("md")}
              download={`conversation-${activeConversation.id}.md`}
              variant="outline"
              size="sm"
            >Markdown</Badge>
            <Badge
              href={exportUrl?.("html")}
              download={`conversation-${activeConversation.id}.html`}
              variant="outline"
              size="sm"
            >HTML</Badge>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System prompt</span>
          {#if systemPromptHref}
            <a
              class="inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
              href={systemPromptHref}
              download
            >
              <ScrollText size={13} strokeWidth={2.2} />Export system prompt
            </a>
          {:else}
            <span class="text-xs text-muted-foreground">No active agent.</span>
          {/if}
        </div>
      </div>
    </PanelSection>
  {/if}
</div>
