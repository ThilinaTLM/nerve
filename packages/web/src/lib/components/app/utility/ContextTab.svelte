<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import FileText from "@lucide/svelte/icons/file-text";
  import Info from "@lucide/svelte/icons/info";
  import type {
    AgentRecord,
    ProjectRecord,
    SessionRecord,
    StatusResponse,
  } from "../../../api";
  import { pulseForStatus, statusTone } from "../../../utils/status";
  import { StatusDot } from "$lib/components/ui/status-dot";

  type Props = {
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    sessionAgents?: AgentRecord[];
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    onSelectAgent?: (agent: AgentRecord) => void;
  };

  let {
    status,
    activeProject,
    activeSession,
    activeAgent,
    sessionAgents = [],
    exportUrl,
    onSelectAgent,
  }: Props = $props();
</script>

<section class="context-card">
  <div class="card-title"><Info size={14} strokeWidth={2.2} /><strong>Active Context</strong></div>
  <dl>
    <dt>Project</dt><dd title={activeProject?.name}>{activeProject?.name ?? "—"}</dd>
    <dt>Directory</dt><dd title={activeProject?.dir}>{activeProject?.dir ?? "—"}</dd>
    <dt>Session</dt><dd title={activeSession?.id}>{activeSession?.id ?? "—"}</dd>
    <dt>Agent</dt><dd title={activeAgent?.id}>{activeAgent?.id ?? "—"}</dd>
    <dt>Daemon</dt><dd title={status?.daemonId}>{status?.daemonId ?? "—"}</dd>
    <dt>Data</dt><dd title={status?.dataDir}>{status?.dataDir ?? "—"}</dd>
  </dl>
</section>
<section class="context-card">
  <div class="card-title"><Bot size={14} strokeWidth={2.2} /><strong>Session Agents</strong></div>
  {#if sessionAgents.length === 0}
    <p class="muted">No agents in the active session.</p>
  {/if}
  {#each sessionAgents as agent}
    <button class="utility-row agent-row" type="button" onclick={() => onSelectAgent?.(agent)}>
      <StatusDot tone={statusTone(agent.status)} pulse={pulseForStatus(agent.status)} />
      <div>
        <strong>{agent.parentAgentId ? "child" : "root"} · {agent.status}</strong>
        <span>{agent.mode} · {agent.permissionLevel} · {agent.id}</span>
      </div>
    </button>
  {/each}
</section>
{#if activeSession}
  <section class="context-card">
    <div class="card-title"><FileText size={14} strokeWidth={2.2} /><strong>Export</strong></div>
    <div class="export-links">
      <a href={exportUrl?.("json")}>JSON</a>
      <a href={exportUrl?.("md")}>Markdown</a>
      <a href={exportUrl?.("html")}>HTML</a>
    </div>
  </section>
{/if}
