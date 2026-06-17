<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import Download from "@lucide/svelte/icons/download";
  import Layers from "@lucide/svelte/icons/layers";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import type {
    AgentRecord,
    ProjectRecord,
    ConversationRecord,
    StatusResponse,
  } from "../../../api";
  import { agentActivityPulse, agentActivityTone } from "../../../utils/status";
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
      {#each conversationAgents as agent, i}
        <button
          class="w-full text-left transition-colors hover:bg-muted/60 {i > 0 ? 'border-t' : ''}"
          type="button"
          onclick={() => onSelectAgent?.(agent)}
        >
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5">
            <dt class="font-mono text-xs text-muted-foreground">Status</dt>
            <dd class="flex items-center gap-1.5 truncate font-mono text-xs text-foreground">
              <StatusDot tone={agentActivityTone(agent.status)} pulse={agentActivityPulse(agent.status)} />
              {agent.status}
            </dd>
            <dt class="font-mono text-xs text-muted-foreground">Mode</dt>
            <dd class="truncate font-mono text-xs text-foreground">{agent.mode}</dd>
            <dt class="font-mono text-xs text-muted-foreground">Permission</dt>
            <dd class="truncate font-mono text-xs text-foreground">{agent.permissionLevel}</dd>
            <dt class="font-mono text-xs text-muted-foreground">Agent</dt>
            <dd class="truncate font-mono text-xs text-foreground" title={agent.id}>{agent.id}</dd>
          </dl>
        </button>
      {/each}
    </div>
  </PanelSection>

  {#if activeConversation}
    <PanelSection title="Export" icon={Download} bind:open={exportOpen}>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</span>
          <div class="flex flex-wrap gap-1.5">
            <Badge href={exportUrl?.("json")} variant="outline" size="sm">JSON</Badge>
            <Badge href={exportUrl?.("md")} variant="outline" size="sm">Markdown</Badge>
            <Badge href={exportUrl?.("html")} variant="outline" size="sm">HTML</Badge>
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
