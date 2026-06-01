<script lang="ts">
  import Bot from "lucide-svelte/icons/bot";
  import FileText from "lucide-svelte/icons/file-text";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Info from "lucide-svelte/icons/info";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
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

  type UtilityTab = "history" | "processes" | "info";
  type StatusTone = "neutral" | "accent" | "good" | "warn" | "danger" | "running";

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
    { value: "info", label: "Info" },
  ]);

  function setTab(tab: string) {
    activeTab = tab as UtilityTab;
    onTabChange?.(activeTab);
  }

  function statusTone(statusValue: string | undefined): StatusTone {
    if (statusValue === "running" || statusValue === "ready" || statusValue === "starting") return "running";
    if (statusValue === "error" || statusValue === "failed" || statusValue === "orphaned") return "danger";
    if (statusValue === "completed" || statusValue === "stopped" || statusValue === "exited") return "good";
    if (statusValue === "pending" || statusValue === "stopping") return "warn";
    return "neutral";
  }

  function logTone(level: string): StatusTone {
    if (level === "error") return "danger";
    if (level === "warn") return "warn";
    return "neutral";
  }
</script>

<aside class="utility-panel">
  <div class="utility-tabs">
    <Tabs tabs={tabs} bind:value={activeTab} ariaLabel="Utility panel tabs" onValueChange={setTab} />
  </div>

  <ScrollArea class="utility-scroll" viewportClass="utility-content" type="auto">
    {#if activeTab === "history"}
      <header class="section-head">
        <div><GitBranch size={14} strokeWidth={2.2} /><strong>History</strong></div>
        <div class="row-actions">
          <Button size="sm" variant="ghost" onclick={onCompact} disabled={!activeSession}>Compact</Button>
          <Button size="sm" variant="ghost" onclick={() => onNavigateToEntry?.(undefined)} disabled={!activeSession}>Root</Button>
        </div>
      </header>

      {#if treeNodes.length}
        <div class="row-list tree-list">
          {#each treeNodes as node}
            <button class="utility-row tree-row" class:active={node.entry.id === activeSession?.activeEntryId} type="button" onclick={() => onNavigateToEntry?.(node.entry.id)}>
              <span class="tree-prefix"></span>
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
            <StatusDot tone={statusTone(process.status)} pulse={process.status === "running" || process.status === "ready"} />
            <div>
              <strong>{process.name ?? process.command}</strong>
              <span>{process.status} · {process.cwd}</span>
            </div>
            <Badge size="xs" tone={statusTone(process.status)}>{process.status}</Badge>
          </button>
        {/each}
      </div>

      {#if selectedProcess}
        <section class="utility-card process-detail">
          <div class="card-title"><StatusDot tone={statusTone(selectedProcess.status)} /><strong>{selectedProcess.name ?? selectedProcess.command}</strong></div>
          <small>{selectedProcess.command}</small>
          <small>{selectedProcess.cwd}</small>
          <div class="row-actions">
            <Button size="sm" variant="secondary" onclick={() => onRestartProcess?.(selectedProcess.id)}>Restart</Button>
            <Button size="sm" variant="danger" onclick={() => onStopProcess?.(selectedProcess.id)}><Square size={12} strokeWidth={2.3} />Stop</Button>
          </div>
        </section>
        <div class="log-list">
          {#each processLogs?.events ?? [] as event}
            <code class={event.level}><span>#{event.seq}</span><StatusDot size="xs" tone={logTone(event.level)} />{event.line}</code>
          {/each}
        </div>
      {/if}
    {:else}
      <section class="utility-card form-card">
        <div class="card-title"><Info size={14} strokeWidth={2.2} /><strong>Active context</strong></div>
        <dl>
          <dt>Project</dt><dd>{activeProject?.name ?? "—"}</dd>
          <dt>Directory</dt><dd>{activeProject?.dir ?? "—"}</dd>
          <dt>Session</dt><dd>{activeSession?.id ?? "—"}</dd>
          <dt>Agent</dt><dd>{activeAgent?.id ?? "—"}</dd>
          <dt>Daemon</dt><dd>{status?.daemonId ?? "—"}</dd>
          <dt>Data</dt><dd>{status?.dataDir ?? "—"}</dd>
        </dl>
      </section>
      <section class="utility-card form-card">
        <div class="card-title"><Bot size={14} strokeWidth={2.2} /><strong>Session agents</strong></div>
        {#if sessionAgents.length === 0}
          <p class="muted">No agents in the active session.</p>
        {/if}
        {#each sessionAgents as agent}
          <button class="utility-row agent-row" type="button" onclick={() => onSelectAgent?.(agent)}>
            <StatusDot tone={statusTone(agent.status)} pulse={agent.status === "running"} />
            <div>
              <strong>{agent.parentAgentId ? "child" : "root"} · {agent.status}</strong>
              <span>{agent.mode} · {agent.permissionLevel} · {agent.id}</span>
            </div>
          </button>
        {/each}
      </section>
      {#if activeSession}
        <section class="utility-card form-card">
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
    background: var(--color-panel-muted);
    border-left: 1px solid var(--color-border-subtle);
  }

  .utility-tabs {
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-titlebar);
  }

  :global(.utility-scroll) {
    min-height: 0;
  }

  :global(.utility-content) {
    display: grid;
    align-content: start;
    min-height: 100%;
    gap: 0.42rem;
    padding: 0.45rem;
  }

  .section-head,
  .row-actions,
  .export-links,
  .card-title {
    display: flex;
    align-items: center;
    gap: 0.38rem;
  }

  .section-head {
    justify-content: space-between;
    margin-bottom: 0.05rem;
  }

  .section-head div,
  .card-title {
    min-width: 0;
  }

  .section-head strong,
  .card-title strong {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .row-list,
  .tree-list,
  .form-card {
    display: grid;
    gap: 0.32rem;
  }

  .utility-row,
  .utility-card {
    width: 100%;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.42rem;
    text-align: left;
    box-shadow: var(--shadow-panel);
  }

  .utility-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
    cursor: pointer;
  }

  .utility-card {
    display: grid;
    gap: 0.32rem;
  }

  .utility-row:hover,
  .utility-row.active {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
  }

  .tree-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .tree-prefix {
    width: 0.65rem;
    height: 1px;
    background: var(--color-border);
  }

  .utility-row div,
  .process-detail {
    min-width: 0;
  }

  .utility-row strong,
  .utility-row span,
  .utility-card small,
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

  .process-list,
  .log-list {
    display: grid;
    gap: 0.28rem;
  }

  .log-list {
    min-height: 0;
    max-height: 18rem;
    overflow: auto;
  }

  code {
    display: flex;
    align-items: start;
    gap: 0.35rem;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-deep);
    color: var(--color-code);
    padding: 0.34rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    white-space: pre-wrap;
  }

  code.warn {
    color: var(--color-warn);
  }

  code.error {
    color: var(--color-danger);
  }

  code span {
    color: var(--color-faint);
  }

  .muted {
    margin: 0;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.3rem 0.55rem;
    margin: 0;
    font-size: var(--text-xs);
  }

  dd {
    margin: 0;
  }

  a {
    color: var(--color-accent);
  }
</style>
