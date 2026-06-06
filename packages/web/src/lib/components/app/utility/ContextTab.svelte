<script lang="ts">
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import type {
    AgentRecord,
    ProjectRecord,
    ConversationRecord,
    StatusResponse,
  } from "../../../api";
  import { pulseForStatus, statusTone } from "../../../utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { Card } from "$lib/components/ui/card";
  import { StatusDot } from "$lib/components/ui/status-dot";

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
  <Card class="gap-0 overflow-hidden p-0">
    <div class="border-b px-3 py-2 text-xs font-semibold text-foreground">Active Context</div>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5">
      {#each fields as field}
        <dt class="font-mono text-xs text-muted-foreground">{field.label}</dt>
        <dd class="truncate font-mono text-xs text-foreground" title={field.value}>
          {field.value ?? "—"}
        </dd>
      {/each}
    </dl>
  </Card>

  <Card class="gap-0 overflow-hidden p-0">
    <div class="border-b px-3 py-2 text-xs font-semibold text-foreground">Conversation Agents</div>
    <div class="flex flex-col">
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
              <StatusDot tone={statusTone(agent.status)} pulse={pulseForStatus(agent.status)} />
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
  </Card>

  {#if activeConversation}
    <Card class="gap-0 overflow-hidden p-0">
      <div class="border-b px-3 py-2 text-xs font-semibold text-foreground">Export</div>
      <div class="flex flex-col gap-3 px-3 py-2.5">
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
    </Card>
  {/if}
</div>
