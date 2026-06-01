<script lang="ts">
  import Activity from "lucide-svelte/icons/activity";
  import Bot from "lucide-svelte/icons/bot";
  import CheckCircle2 from "lucide-svelte/icons/check-circle-2";
  import FileText from "lucide-svelte/icons/file-text";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Info from "lucide-svelte/icons/info";
  import KeyRound from "lucide-svelte/icons/key-round";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import Settings2 from "lucide-svelte/icons/settings-2";
  import ShieldAlert from "lucide-svelte/icons/shield-alert";
  import Square from "lucide-svelte/icons/square";
  import Terminal from "lucide-svelte/icons/terminal";
  import XCircle from "lucide-svelte/icons/x-circle";
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
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Input from "../ui/Input.svelte";
  import Select, { type SelectItem } from "../ui/Select.svelte";
  import Switch from "../ui/Switch.svelte";
  import Tabs, { type TabItem } from "../ui/Tabs.svelte";

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

  const tabs = $derived<TabItem[]>([
    { value: "history", label: "History" },
    { value: "approvals", label: "Approvals", count: approvals.length },
    { value: "processes", label: "Processes", count: processes.length },
    { value: "settings", label: "Settings" },
    { value: "events", label: "Events", count: eventItems.length },
    { value: "info", label: "Info" },
  ]);

  const modeItems: SelectItem[] = [
    { value: "planning", label: "Planning" },
    { value: "coding", label: "Coding" },
  ];

  const permissionItems: SelectItem[] = [
    { value: "read_only", label: "Read only" },
    { value: "supervised", label: "Supervised" },
    { value: "autonomous", label: "Autonomous" },
  ];

  function setTab(tab: string) {
    activeTab = tab as UtilityTab;
    onTabChange?.(activeTab);
  }

  function statusTone(statusValue: string | undefined): "neutral" | "accent" | "good" | "warn" | "danger" | "running" {
    if (statusValue === "running") return "running";
    if (statusValue === "error" || statusValue === "failed") return "danger";
    if (statusValue === "completed" || statusValue === "stopped") return "good";
    if (statusValue === "pending") return "warn";
    return "neutral";
  }

  function updateNumber(path: "thresholdTokens" | "keepRecentTokens", value: string) {
    if (!settingsDraft) return;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) settingsDraft.compaction[path] = Math.floor(parsed);
  }

  function providerCommand(provider: AuthProviderMetadata): string {
    if (provider.supportsOAuth) return `nerve auth login ${provider.provider}`;
    if (provider.supportsApiKey) return `nerve auth set ${provider.provider}`;
    return "nerve auth list";
  }
</script>

<aside class="utility-panel">
  <div class="utility-tabs">
    <Tabs tabs={tabs} bind:value={activeTab} ariaLabel="Utility panel tabs" onValueChange={setTab} />
  </div>

  <div class="utility-content">
    {#if activeTab === "history"}
      <header class="section-head">
        <div><GitBranch size={14} strokeWidth={2.2} /><strong>Branch history</strong></div>
        <div class="row-actions">
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
      <header class="section-head"><div><ShieldAlert size={14} strokeWidth={2.2} /><strong>Approvals</strong></div><Badge tone={approvals.length ? "warn" : "neutral"}>{approvals.length}</Badge></header>
      {#if approvals.length}
        <div class="row-list">
          {#each approvals as approval}
            <section class="utility-card approval-card">
              <strong>{approval.toolCall?.toolName ?? "tool call"}</strong>
              <span>{approval.reason}</span>
              {#if approval.toolCall}<code>{JSON.stringify(approval.toolCall.args, null, 2)}</code>{/if}
              <div class="row-actions">
                <Button size="sm" onclick={() => onGrantApproval?.(approval.id)}><CheckCircle2 size={12} strokeWidth={2.3} />Approve</Button>
                <Button size="sm" variant="secondary" onclick={() => onDenyApproval?.(approval.id)}><XCircle size={12} strokeWidth={2.3} />Deny</Button>
              </div>
            </section>
          {/each}
        </div>
      {:else}
        <p class="muted">No pending approvals.</p>
      {/if}
    {:else if activeTab === "processes"}
      <header class="section-head">
        <div><Terminal size={14} strokeWidth={2.2} /><strong>Processes</strong></div>
        <Button size="sm" variant="ghost" onclick={onRefreshProcessLogs}><RefreshCw size={12} strokeWidth={2.2} />Refresh</Button>
      </header>
      <div class="row-list process-list">
        {#each processes as process}
          <button class="utility-row process-row" class:active={process.id === selectedProcess?.id} type="button" onclick={() => onSelectProcess?.(process.id)}>
            <strong>{process.name ?? process.command}</strong>
            <span>{process.id}</span>
            <Badge tone={statusTone(process.status)}>{process.status}</Badge>
          </button>
        {/each}
      </div>
      {#if selectedProcess}
        <section class="utility-card selected-process">
          <strong>{selectedProcess.name ?? selectedProcess.id}</strong>
          <span>{selectedProcess.command}</span>
          <span>{selectedProcess.cwd}</span>
          <div class="row-actions">
            <Button size="sm" variant="secondary" onclick={() => onStopProcess?.(selectedProcess.id)}><Square size={12} />Stop</Button>
            <Button size="sm" onclick={() => onRestartProcess?.(selectedProcess.id)}><RefreshCw size={12} />Restart</Button>
          </div>
        </section>
      {/if}
      {#if processLogs?.events.length}
        <div class="log-list">
          {#each processLogs.events as log}<code class:error={log.level === "error"} class:warn={log.level === "warn"}>{log.seq} {log.line}</code>{/each}
        </div>
      {:else}
        <p class="muted">No log events selected.</p>
      {/if}
    {:else if activeTab === "settings"}
      <header class="section-head"><div><Settings2 size={14} strokeWidth={2.2} /><strong>Settings</strong></div><Button size="sm" variant="ghost" onclick={onLoadSettings}>Refresh</Button></header>
      {#if settingsDraft}
        <section class="utility-card form-card">
          <label>Default mode
            <Select items={modeItems} value={settingsDraft.defaultMode} ariaLabel="Default mode" onValueChange={(value) => { if (settingsDraft) settingsDraft.defaultMode = value as Settings["defaultMode"]; }} />
          </label>
          <label>Default permission
            <Select items={permissionItems} value={settingsDraft.defaultPermissionLevel} ariaLabel="Default permission" onValueChange={(value) => { if (settingsDraft) settingsDraft.defaultPermissionLevel = value as Settings["defaultPermissionLevel"]; }} />
          </label>
          <Switch bind:checked={settingsDraft.compaction.auto} label="Auto-compact sessions" description="Let the daemon compact long branches when thresholds are reached." />
          <div class="number-grid">
            <label>Threshold tokens<Input value={String(settingsDraft.compaction.thresholdTokens)} type="number" size="sm" ariaLabel="Compaction threshold tokens" oninput={(event) => updateNumber("thresholdTokens", (event.currentTarget as HTMLInputElement).value)} /></label>
            <label>Keep recent<Input value={String(settingsDraft.compaction.keepRecentTokens)} type="number" size="sm" ariaLabel="Keep recent tokens" oninput={(event) => updateNumber("keepRecentTokens", (event.currentTarget as HTMLInputElement).value)} /></label>
          </div>
          <Button size="sm" onclick={onSaveSettings}>Save settings</Button>
        </section>
      {/if}

      <section class="utility-card provider-card">
        <div class="card-title"><KeyRound size={14} strokeWidth={2.2} /><strong>Provider access</strong></div>
        {#if authProviders.length === 0}
          <p class="muted">No provider metadata available. Use <code>nerve auth list</code> in the CLI.</p>
        {:else}
          <div class="provider-list">
            {#each authProviders as provider}
              <div class="provider-row">
                <div>
                  <strong>{provider.displayName}</strong>
                  <small>{provider.provider}{provider.envVar ? ` · ${provider.envVar}` : ""}</small>
                </div>
                <Badge tone={provider.configured ? "good" : "neutral"}>{provider.configured ? provider.credentialType ?? "configured" : "not configured"}</Badge>
                {#if provider.warning}<p>{provider.warning}</p>{/if}
                <code>{provider.configured ? "nerve auth list" : providerCommand(provider)}</code>
              </div>
            {/each}
          </div>
        {/if}
        <p class="muted">Credentials are managed from the CLI only. Raw secrets are never rendered in the browser.</p>
      </section>

      {#if settingsMessage}<p class="settings-message">{settingsMessage}</p>{/if}
    {:else if activeTab === "events"}
      <header class="section-head"><div><Activity size={14} strokeWidth={2.2} /><strong>Event stream</strong></div><Badge tone="neutral">{eventItems.length}</Badge></header>
      <div class="log-list event-list">{#each eventItems as event}<code>{event}</code>{/each}</div>
    {:else}
      <section class="utility-card form-card">
        <div class="card-title"><Info size={14} strokeWidth={2.2} /><strong>Active context</strong></div>
        <dl>
          <dt>Project</dt><dd>{activeProject?.name ?? "—"}</dd>
          <dt>Session</dt><dd>{activeSession?.id ?? "—"}</dd>
          <dt>Agent</dt><dd>{activeAgent?.id ?? "—"}</dd>
          <dt>Daemon</dt><dd>{status?.daemonId ?? "—"}</dd>
          <dt>Data</dt><dd>{status?.dataDir ?? "—"}</dd>
        </dl>
      </section>
      <section class="utility-card form-card">
        <div class="card-title"><Bot size={14} strokeWidth={2.2} /><strong>Session agents</strong></div>
        {#each sessionAgents as agent}
          <button class="utility-row" type="button" onclick={() => onSelectAgent?.(agent)}>
            <strong>{agent.parentAgentId ? "child" : "root"} · {agent.status}</strong>
            <span>{agent.mode} · {agent.permissionLevel} · {agent.id}</span>
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
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-titlebar);
  }

  .utility-content {
    display: grid;
    align-content: start;
    min-height: 0;
    gap: 0.45rem;
    overflow: auto;
    padding: 0.5rem;
  }

  .section-head,
  .row-actions,
  .export-links,
  .card-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .section-head {
    justify-content: space-between;
    margin-bottom: 0.1rem;
  }

  .section-head div,
  .card-title {
    color: var(--color-text);
  }

  .section-head strong,
  .card-title strong {
    font-size: 0.78rem;
  }

  .row-list,
  .log-list,
  .form-card,
  .provider-list {
    display: grid;
    gap: 0.35rem;
  }

  .utility-row,
  .utility-card {
    display: grid;
    width: 100%;
    gap: 0.28rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.48rem;
    text-align: left;
    box-shadow: var(--shadow-panel);
  }

  .utility-row {
    cursor: pointer;
  }

  .utility-row:hover,
  .utility-row.active {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
  }

  .process-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .process-row > span {
    grid-column: 1;
  }

  .process-row :global(.ui-badge) {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
  }

  .utility-row span,
  .utility-card span,
  .muted,
  dt,
  small {
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .provider-card {
    gap: 0.5rem;
  }

  .provider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    padding: 0.42rem;
  }

  .provider-row div,
  .provider-row small {
    display: grid;
    min-width: 0;
  }

  .provider-row p,
  .provider-row code {
    grid-column: 1 / -1;
  }

  .number-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem;
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

  code.warn {
    color: var(--color-warn);
  }

  .muted code {
    display: inline;
    padding: 0.1rem 0.25rem;
    white-space: normal;
  }

  .settings-message {
    margin: 0;
    border: 1px solid var(--color-accent-soft);
    border-radius: var(--radius-sm);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    padding: 0.42rem;
    font-size: 0.74rem;
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

  .event-list {
    min-height: 0;
  }
</style>
