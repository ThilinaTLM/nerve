<script lang="ts">
  import Bot from "lucide-svelte/icons/bot";
  import FileText from "lucide-svelte/icons/file-text";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Info from "lucide-svelte/icons/info";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import RotateCw from "lucide-svelte/icons/rotate-cw";
  import Square from "lucide-svelte/icons/square";
  import Terminal from "lucide-svelte/icons/terminal";
  import type {
    AgentRecord,
    ProcessLogQueryResponse,
    ProcessRecord,
    ProjectRecord,
    SessionRecord,
    SessionTreeNode,
    StatusResponse,
  } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import ScrollArea from "../ui/ScrollArea.svelte";
  import StatusDot from "../ui/StatusDot.svelte";
  import Tabs, { type TabItem } from "../ui/Tabs.svelte";
  import { logLevelTone, pulseForStatus, statusTone } from "../../utils/status";
  import { timeLabel } from "../../utils/time";

  type UtilityTab = "history" | "processes" | "info";

  type Props = {
    activeTab?: UtilityTab;
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    sessionAgents?: AgentRecord[];
    treeNodes?: SessionTreeNode[];
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    processLogs?: ProcessLogQueryResponse;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onCompact?: () => void;
    onSelectProcess?: (id: string) => void;
    onRefreshProcessLogs?: () => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
  };

  let {
    activeTab = $bindable<UtilityTab>("history"),
    status,
    activeProject,
    activeSession,
    activeAgent,
    sessionAgents = [],
    treeNodes = [],
    processes = [],
    selectedProcess,
    processLogs,
    exportUrl,
    onTabChange,
    onSelectAgent,
    onNavigateToEntry,
    onCompact,
    onSelectProcess,
    onRefreshProcessLogs,
    onStopProcess,
    onRestartProcess,
  }: Props = $props();

  const tabs = $derived<TabItem[]>([
    { value: "history", label: "History" },
    { value: "processes", label: "Processes", count: processes.length },
    { value: "info", label: "Context" },
  ]);

  function setTab(tab: string) {
    activeTab = tab as UtilityTab;
    onTabChange?.(activeTab);
  }

</script>

<aside class="utility-panel">
  <div class="utility-tabs">
    <Tabs tabs={tabs} bind:value={activeTab} ariaLabel="Utility panel tabs" onValueChange={setTab} />
  </div>

  <ScrollArea class="utility-scroll" viewportClass="utility-content" type="auto">
    {#if activeTab === "history"}
      <header class="section-head">
        <div><GitBranch size={14} strokeWidth={2.2} /><strong>Branch History</strong></div>
        <div class="row-actions">
          <Button size="sm" variant="ghost" onclick={onCompact} disabled={!activeSession}>Compact</Button>
          <Button size="sm" variant="ghost" onclick={() => onNavigateToEntry?.(undefined)} disabled={!activeSession}>Root</Button>
        </div>
      </header>

      {#if treeNodes.length}
        <div class="row-list tree-list">
          {#each treeNodes as node, index}
            <button class="utility-row tree-row" class:active={node.entry.id === activeSession?.activeEntryId} type="button" onclick={() => onNavigateToEntry?.(node.entry.id)}>
              <span class="tree-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{node.entry.role} · {node.entry.kind}</strong>
                <span>{node.entry.text.slice(0, 120) || "empty entry"}</span>
              </div>
            </button>
          {/each}
        </div>
      {:else}
        <p class="muted">No conversation history loaded.</p>
      {/if}
    {:else if activeTab === "processes"}
      <header class="section-head">
        <div><Terminal size={14} strokeWidth={2.2} /><strong>Processes</strong></div>
        <Button size="sm" variant="ghost" onclick={onRefreshProcessLogs}><RefreshCw size={12} strokeWidth={2.2} />Refresh</Button>
      </header>

      <div class="row-list process-list">
        {#if processes.length === 0}
          <p class="muted">No managed processes.</p>
        {/if}
        {#each processes as process}
          <button class="utility-row process-row" class:active={process.id === selectedProcess?.id} type="button" onclick={() => onSelectProcess?.(process.id)}>
            <StatusDot tone={statusTone(process.status)} pulse={pulseForStatus(process.status)} />
            <div>
              <strong>{process.name ?? process.command}</strong>
              <span>{process.status} · {process.cwd}</span>
            </div>
            <Badge size="xs" tone={statusTone(process.status)}>{process.status}</Badge>
          </button>
        {/each}
      </div>

      {#if selectedProcess}
        <section class="process-detail">
          <div class="process-title"><StatusDot tone={statusTone(selectedProcess.status)} pulse={pulseForStatus(selectedProcess.status)} /><strong>{selectedProcess.name ?? selectedProcess.command}</strong></div>
          <small title={selectedProcess.command}>{selectedProcess.command}</small>
          <small title={selectedProcess.cwd}>{selectedProcess.cwd}</small>
          <div class="row-actions">
            <Button size="sm" variant="secondary" onclick={() => onRestartProcess?.(selectedProcess.id)}><RotateCw size={12} strokeWidth={2.3} />Restart</Button>
            <Button size="sm" variant="danger" onclick={() => onStopProcess?.(selectedProcess.id)}><Square size={12} strokeWidth={2.3} />Stop</Button>
          </div>
        </section>
        <div class="log-terminal" role="log" aria-label="Process logs">
          {#if (processLogs?.events ?? []).length === 0}
            <code><span class="seq">--</span><span class="time">--:--:--</span><span class="line">No logs captured.</span></code>
          {/if}
          {#each processLogs?.events ?? [] as event}
            <code class={event.level}>
              <span class="seq">#{event.seq}</span>
              <span class="time">{timeLabel(event.ts)}</span>
              <StatusDot size="xs" tone={logLevelTone(event.level)} />
              <span class="line">{event.line}</span>
            </code>
          {/each}
        </div>
      {/if}
    {:else}
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
    {/if}
  </ScrollArea>
</aside>

<style>
  .utility-panel {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    border-left: 1px solid var(--color-border);
    background: var(--color-pane);
  }

  .utility-tabs {
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel-muted);
  }

  :global(.utility-scroll) {
    min-height: 0;
  }

  :global(.utility-content) {
    display: grid;
    align-content: start;
    min-height: 100%;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .section-head,
  .row-actions,
  .export-links,
  .card-title,
  .process-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .section-head {
    justify-content: space-between;
  }

  .section-head div,
  .card-title,
  .process-title {
    min-width: 0;
  }

  .section-head strong,
  .card-title strong,
  .process-title strong {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-list,
  .tree-list,
  .context-card {
    display: grid;
    gap: 0.32rem;
  }

  .utility-row,
  .context-card,
  .process-detail {
    width: 100%;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.45rem;
    text-align: left;
  }

  .utility-row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
    cursor: pointer;
  }

  .context-card,
  .process-detail {
    display: grid;
    gap: 0.38rem;
  }

  .utility-row:hover,
  .utility-row.active {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
  }

  .utility-row.active::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    background: var(--color-accent);
  }

  .tree-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .tree-index {
    color: var(--color-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .utility-row div,
  .process-detail {
    min-width: 0;
  }

  .utility-row strong,
  .utility-row span,
  .process-detail small,
  dd {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .utility-row strong {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .utility-row span,
  dt,
  small,
  .muted {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .utility-row span,
  dt,
  dd,
  small {
    font-family: var(--font-mono);
  }

  .process-list,
  .log-terminal {
    display: grid;
    gap: 0.28rem;
  }

  .log-terminal {
    min-height: 18rem;
    max-height: 48vh;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-code-bg);
    padding: 0.4rem;
  }

  .log-terminal code {
    display: grid;
    grid-template-columns: 3rem 4.8rem auto minmax(0, 1fr);
    align-items: start;
    gap: 0.4rem;
    min-width: 0;
    color: var(--color-message-text);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    white-space: pre-wrap;
  }

  .log-terminal code.warn .line {
    color: var(--color-warn);
  }

  .log-terminal code.error .line {
    color: var(--color-danger);
  }

  .seq {
    color: var(--color-faint);
  }

  .time {
    color: var(--color-good);
  }

  .line {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .muted {
    margin: 0;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.34rem 0.6rem;
    margin: 0;
    font-size: var(--text-xs);
  }

  dd {
    margin: 0;
    color: var(--color-text);
  }

  a {
    color: var(--color-accent);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }
</style>
