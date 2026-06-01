<script lang="ts">
  import type {
    AgentRecord,
    ApprovalWithToolCall,
    AuthProviderMetadata,
    ProcessLogQueryResponse,
    ProcessRecord,
    ProjectRecord,
    SessionRecord,
    SessionTreeNode,
    Settings,
    StatusResponse,
  } from "../../api";
  import Button from "../ui/Button.svelte";

  type UtilityTab = "history" | "approvals" | "processes" | "settings" | "events" | "info";

  type Props = {
    activeTab?: UtilityTab;
    status?: StatusResponse;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    sessionAgents?: AgentRecord[];
    treeNodes?: SessionTreeNode[];
    approvals?: ApprovalWithToolCall[];
    processes?: ProcessRecord[];
    selectedProcess?: ProcessRecord;
    processLogs?: ProcessLogQueryResponse;
    eventItems?: string[];
    settingsDraft?: Settings;
    authProviders?: AuthProviderMetadata[];
    settingsMessage?: string;
    exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
    onTabChange?: (tab: UtilityTab) => void;
    onSelectAgent?: (agent: AgentRecord) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onCompact?: () => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
    onSelectProcess?: (id: string) => void;
    onRefreshProcessLogs?: () => void;
    onStopProcess?: (id: string) => void;
    onRestartProcess?: (id: string) => void;
    onLoadSettings?: () => void;
    onSaveSettings?: () => void;
  };

  let {
    activeTab = "history",
    status,
    activeProject,
    activeSession,
    activeAgent,
    sessionAgents = [],
    treeNodes = [],
    approvals = [],
    processes = [],
    selectedProcess,
    processLogs,
    eventItems = [],
    settingsDraft = $bindable<Settings | undefined>(),
    authProviders = [],
    settingsMessage,
    exportUrl,
    onTabChange,
    onSelectAgent,
    onNavigateToEntry,
    onCompact,
    onGrantApproval,
    onDenyApproval,
    onSelectProcess,
    onRefreshProcessLogs,
    onStopProcess,
    onRestartProcess,
    onLoadSettings,
    onSaveSettings,
  }: Props = $props();

  const tabs: { id: UtilityTab; label: string; count?: number }[] = [
    { id: "history", label: "History" },
    { id: "approvals", label: "Approvals", count: approvals.length },
    { id: "processes", label: "Processes", count: processes.length },
    { id: "settings", label: "Settings" },
    { id: "events", label: "Events", count: eventItems.length },
    { id: "info", label: "Info" },
  ];

  function setTab(tab: UtilityTab) {
    activeTab = tab;
    onTabChange?.(tab);
  }
</script>

<aside class="utility-panel">
  <nav class="utility-tabs">
    {#each tabs as tab}
      <button type="button" class:active={activeTab === tab.id} onclick={() => setTab(tab.id)}>
        {tab.label}{#if tab.count}<span>{tab.count}</span>{/if}
      </button>
    {/each}
  </nav>

  <div class="utility-content">
    {#if activeTab === "history"}
      <header class="section-head">
        <strong>Branch history</strong>
        <div>
          <Button size="sm" variant="ghost" onclick={onCompact} disabled={!activeSession}>Compact</Button>
          <Button size="sm" variant="ghost" onclick={() => onNavigateToEntry?.(undefined)} disabled={!activeSession}>Root</Button>
        </div>
      </header>
      {#if treeNodes.length}
        <div class="row-list">
          {#each treeNodes as node}
            <button class="utility-row" type="button" onclick={() => onNavigateToEntry?.(node.entry.id)}>
              <strong>{node.entry.kind && node.entry.kind !== "message" ? node.entry.kind.replace("_", " ") : node.entry.role}</strong>
              <span>{node.entry.text.slice(0, 130) || node.entry.id}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="muted">No branch metadata loaded.</p>
      {/if}
    {:else if activeTab === "approvals"}
      {#if approvals.length}
        <div class="row-list">
          {#each approvals as approval}
            <section class="utility-card">
              <strong>{approval.toolCall?.toolName ?? "tool call"}</strong>
              <span>{approval.reason}</span>
              {#if approval.toolCall}<code>{JSON.stringify(approval.toolCall.args, null, 2)}</code>{/if}
              <div class="row-actions">
                <Button size="sm" onclick={() => onGrantApproval?.(approval.id)}>Approve</Button>
                <Button size="sm" variant="secondary" onclick={() => onDenyApproval?.(approval.id)}>Deny</Button>
              </div>
            </section>
          {/each}
        </div>
      {:else}
        <p class="muted">No pending approvals.</p>
      {/if}
    {:else if activeTab === "processes"}
      <header class="section-head"><strong>Processes</strong><Button size="sm" variant="ghost" onclick={onRefreshProcessLogs}>Refresh</Button></header>
      <div class="row-list">
        {#each processes as process}
          <button class="utility-row" class:active={process.id === selectedProcess?.id} type="button" onclick={() => onSelectProcess?.(process.id)}>
            <strong>{process.name ?? process.command}</strong>
            <span>{process.status} · {process.id}</span>
          </button>
        {/each}
      </div>
      {#if selectedProcess}
        <section class="utility-card">
          <strong>{selectedProcess.name ?? selectedProcess.id}</strong>
          <span>{selectedProcess.command}</span>
          <span>{selectedProcess.cwd}</span>
          <div class="row-actions">
            <Button size="sm" variant="secondary" onclick={() => onStopProcess?.(selectedProcess.id)}>Stop</Button>
            <Button size="sm" onclick={() => onRestartProcess?.(selectedProcess.id)}>Restart</Button>
          </div>
        </section>
      {/if}
      {#if processLogs?.events.length}
        <div class="log-list">
          {#each processLogs.events as log}<code class:error={log.level === "error"}>{log.seq} {log.line}</code>{/each}
        </div>
      {/if}
    {:else if activeTab === "settings"}
      <header class="section-head"><strong>Settings</strong><Button size="sm" variant="ghost" onclick={onLoadSettings}>Refresh</Button></header>
      {#if settingsDraft}
        <section class="utility-card form-card">
          <label>Default mode
            <select bind:value={settingsDraft.defaultMode}>
              <option value="planning">planning</option>
              <option value="coding">coding</option>
            </select>
          </label>
          <label>Default permission
            <select bind:value={settingsDraft.defaultPermissionLevel}>
              <option value="read_only">read only</option>
              <option value="supervised">supervised</option>
              <option value="autonomous">autonomous</option>
            </select>
          </label>
          <label><input type="checkbox" bind:checked={settingsDraft.compaction.auto} /> Auto-compact sessions</label>
          <Button size="sm" onclick={onSaveSettings}>Save settings</Button>
        </section>
      {/if}

      <section class="utility-card form-card">
        <strong>Configured providers</strong>
        {#if authProviders.length === 0}
          <p class="muted">No provider credentials configured.</p>
        {:else}
          {#each authProviders as provider}
            <div class="provider-row">
              <span>{provider.displayName}<small>{provider.provider} · {provider.credentialType ?? "configured"}</small></span>
            </div>
            {#if provider.warning}<p class="muted">{provider.warning}</p>{/if}
          {/each}
        {/if}
        <p class="muted">Add or remove providers from the CLI: <code>nerve auth list</code></p>
      </section>

      {#if settingsMessage}<p class="muted">{settingsMessage}</p>{/if}
    {:else if activeTab === "events"}
      <div class="log-list">{#each eventItems as event}<code>{event}</code>{/each}</div>
    {:else}
      <section class="utility-card form-card">
        <strong>Active</strong>
        <dl>
          <dt>Project</dt><dd>{activeProject?.name ?? "—"}</dd>
          <dt>Session</dt><dd>{activeSession?.id ?? "—"}</dd>
          <dt>Agent</dt><dd>{activeAgent?.id ?? "—"}</dd>
          <dt>Daemon</dt><dd>{status?.daemonId ?? "—"}</dd>
          <dt>Data</dt><dd>{status?.dataDir ?? "—"}</dd>
        </dl>
      </section>
      <section class="utility-card form-card">
        <strong>Session agents</strong>
        {#each sessionAgents as agent}
          <button class="utility-row" type="button" onclick={() => onSelectAgent?.(agent)}>
            <strong>{agent.parentAgentId ? "child" : "root"} · {agent.status}</strong>
            <span>{agent.mode} · {agent.permissionLevel} · {agent.id}</span>
          </button>
        {/each}
      </section>
      {#if activeSession}
        <section class="utility-card form-card">
          <strong>Export</strong>
          <div class="export-links">
            <a href={exportUrl?.("json")}>JSON</a>
            <a href={exportUrl?.("md")}>Markdown</a>
            <a href={exportUrl?.("html")}>HTML</a>
          </div>
        </section>
      {/if}
    {/if}
  </div>
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
    display: flex;
    gap: 0.15rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 0.3rem;
  }

  .utility-tabs button {
    flex: 0 0 auto;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted);
    padding: 0.28rem 0.4rem;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .utility-tabs button.active,
  .utility-tabs button:hover {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .utility-tabs span {
    margin-left: 0.25rem;
    color: var(--color-accent);
  }

  .utility-content {
    min-height: 0;
    overflow: auto;
    padding: 0.45rem;
  }

  .section-head,
  .row-actions,
  .export-links {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .section-head {
    margin-bottom: 0.45rem;
  }

  .row-list,
  .log-list,
  .form-card {
    display: grid;
    gap: 0.35rem;
  }

  .utility-row,
  .utility-card {
    display: grid;
    width: 100%;
    gap: 0.2rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.45rem;
    text-align: left;
  }

  .utility-row {
    cursor: pointer;
  }

  .utility-row:hover,
  .utility-row.active {
    background: var(--color-panel-raised);
  }

  .utility-row span,
  .utility-card span,
  .muted,
  dt,
  small {
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .provider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 0.35rem;
  }

  .provider-row span,
  small {
    display: grid;
    min-width: 0;
  }

  select {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.35rem;
  }

  label {
    display: grid;
    gap: 0.25rem;
    color: var(--color-muted);
    font-size: 0.76rem;
  }

  code {
    display: block;
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-deep);
    color: var(--color-code);
    padding: 0.38rem;
    font-size: 0.7rem;
    white-space: pre-wrap;
  }

  code.error {
    color: var(--color-danger);
  }

  .muted code {
    display: inline;
    padding: 0.1rem 0.25rem;
    white-space: normal;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.3rem 0.55rem;
    margin: 0;
    font-size: 0.76rem;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  a {
    color: var(--color-accent);
  }
</style>
