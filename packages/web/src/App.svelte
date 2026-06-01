<script lang="ts">
  import { onMount } from "svelte";
  import { Pane, PaneGroup, PaneResizer } from "paneforge";
  import type { InspectorTab, ThemePreference } from "./lib/state/app-state.svelte";
  import {
    applyTheme,
    composerDraft,
    eventBuffer,
    layout,
    loadThemePreference,
    pushEventPreview,
    resetSelection,
    selection,
    themeState,
  } from "./lib/state/app-state.svelte";
  import {
    apiGet,
    apiPost,
    cancelOAuthFlow,
    compactSession,
    deleteAuthCredential,
    deleteProviderKey,
    getAuthProviders,
    getClientConfig,
    getFileCompletions,
    getModels,
    getOAuthFlow,
    getPendingApprovals,
    getProcessLogs,
    getSessionMessages,
    getSessionTree,
    getProviderKeys,
    getSettings,
    getSlashCompletions,
    getWorkspaceSnapshot,
    respondOAuthFlow,
    startOAuthFlow,
    type AgentRecord,
    type ApprovalWithToolCall,
    type AuthProviderMetadata,
    type ClientConfig,
    type CompletionItem,
    type EventEnvelope,
    type ModelInfo,
    type ModelSelection,
    type OAuthFlowInfo,
    type ProcessLogQueryResponse,
    type ProcessRecord,
    type ProviderApiKey,
    type ProjectRecord,
    type SessionEntry,
    type SessionRecord,
    type SessionTreeNode,
    type Settings,
    type StatusResponse,
    restartProcess,
    setProviderKey,
    stopProcess,
    updateAgentModel,
    updateSettings,
  } from "./lib/api";
  import { queryClient, queryKeys } from "./lib/query";
  import Badge from "./lib/components/ui/Badge.svelte";
  import Button from "./lib/components/ui/Button.svelte";
  import Card from "./lib/components/ui/Card.svelte";
  import Input from "./lib/components/ui/Input.svelte";
  import { Tabs } from "./lib/components/ui/primitives";
  import CodeMirrorComposer from "./lib/CodeMirrorComposer.svelte";
  import Markdown from "./lib/Markdown.svelte";

  type TranscriptItem = {
    id?: string;
    role: "user" | "assistant" | "system";
    kind?: SessionEntry["kind"];
    text: string;
  };

  let status = $state<StatusResponse | undefined>(undefined);
  let config = $state<ClientConfig | undefined>(undefined);
  let connection = $state("connecting");
  let error = $state<string | undefined>(undefined);
  let sending = $state(false);
  let projects = $state<ProjectRecord[]>([]);
  let sessions = $state<SessionRecord[]>([]);
  let agents = $state<AgentRecord[]>([]);
  let treeNodes = $state<SessionTreeNode[]>([]);
  let approvals = $state<ApprovalWithToolCall[]>([]);
  let processes = $state<ProcessRecord[]>([]);
  let selectedProcessId = $state<string | undefined>(undefined);
  let processLogs = $state<ProcessLogQueryResponse | undefined>(undefined);
  let transcript = $state<TranscriptItem[]>([]);
  let streamingText = $state("");
  let slashCompletions = $state<CompletionItem[]>([]);
  let models = $state<ModelInfo[]>([]);
  let selectedModelKey = $state("nerve-faux:faux-fast");
  let settingsDraft = $state<Settings | undefined>(undefined);
  let providerKeys = $state<ProviderApiKey[]>([]);
  let authProviders = $state<AuthProviderMetadata[]>([]);
  let activeOAuthFlow = $state<OAuthFlowInfo | undefined>(undefined);
  let oauthResponseDraft = $state<Record<string, string>>({});
  let providerKeyDraft = $state<Record<string, string>>({});
  let settingsMessage = $state<string | undefined>(undefined);
  let socket: WebSocket | undefined;

  const activeProject = $derived(projects.find((project) => project.id === selection.projectId));
  const activeSession = $derived(sessions.find((session) => session.id === selection.sessionId));
  const activeAgent = $derived(agents.find((agent) => agent.id === selection.agentId));
  const live = $derived(connection === "live");
  const branchDepth = $derived(treeNodes.length);
  const pendingApprovalCount = $derived(approvals.length);
  const selectedProcess = $derived(processes.find((process) => process.id === selectedProcessId));
  const sessionAgents = $derived(
    agents.filter((agent) => agent.sessionId === selection.sessionId),
  );

  function agentLabel(agent: AgentRecord): string {
    return agent.parentAgentId ? "child" : "root";
  }

  function selectAgent(agent: AgentRecord) {
    selection.agentId = agent.id;
    selection.projectId = agent.projectId;
    selection.sessionId = agent.sessionId;
    layout.inspectorTab = "session";
  }

  function entriesToTranscript(entries: SessionEntry[]): TranscriptItem[] {
    return entries
      .filter((entry) => entry.role === "user" || entry.role === "assistant" || entry.kind !== "message")
      .map((entry) => ({ id: entry.id, role: entry.role, kind: entry.kind, text: entry.text }));
  }

  async function loadWorkspaceState() {
    const snapshot = await queryClient.fetchQuery({
      queryKey: queryKeys.workspace,
      queryFn: getWorkspaceSnapshot,
    });
    projects = snapshot.projects;
    sessions = snapshot.sessions;
    agents = snapshot.agents;
    processes = snapshot.processes;
    selectedProcessId = selectedProcessId ?? processes[0]?.id;
    approvals = await getPendingApprovals();
    if (selectedProcessId) processLogs = await getProcessLogs(selectedProcessId);
  }

  async function loadSlashCommands() {
    slashCompletions = await queryClient.fetchQuery({
      queryKey: queryKeys.slashCompletions,
      queryFn: getSlashCompletions,
    });
  }

  async function loadSettingsPanel() {
    const [settings, modelList, keys, auth] = await Promise.all([
      getSettings(),
      getModels(),
      getProviderKeys(),
      getAuthProviders(),
    ]);
    settingsDraft = settings;
    models = modelList;
    providerKeys = keys;
    authProviders = auth;
    if (activeAgent?.model) {
      selectedModelKey = modelKey(activeAgent.model);
    } else if (!modelList.some((model) => modelKey(model) === selectedModelKey)) {
      selectedModelKey = modelKey(modelList[0] ?? { provider: "nerve-faux", modelId: "faux-fast" });
    }
  }

  function modelKey(model: { provider: string; modelId: string }): string {
    return `${model.provider}:${model.modelId}`;
  }

  function selectedModel(): ModelSelection | undefined {
    const [provider, ...modelParts] = selectedModelKey.split(":");
    const modelId = modelParts.join(":");
    return provider && modelId ? { provider, modelId } : undefined;
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    settingsMessage = undefined;
    settingsDraft = await updateSettings(settingsDraft);
    settingsMessage = "Settings saved. Server host/port changes apply after daemon restart.";
  }

  async function saveActiveModel() {
    if (!selection.agentId) return;
    const agent = await updateAgentModel(selection.agentId, selectedModel());
    agents = agents.map((candidate) => candidate.id === agent.id ? agent : candidate);
    settingsMessage = "Agent model updated.";
  }

  async function saveProviderKey(provider: string) {
    const apiKey = providerKeyDraft[provider]?.trim();
    if (!apiKey) return;
    await setProviderKey(provider, apiKey);
    providerKeyDraft = { ...providerKeyDraft, [provider]: "" };
    providerKeys = await getProviderKeys();
    authProviders = await getAuthProviders();
    settingsMessage = `${provider} key saved in encrypted local storage.`;
  }

  async function removeProviderKey(provider: string) {
    await deleteProviderKey(provider);
    providerKeys = await getProviderKeys();
    authProviders = await getAuthProviders();
    settingsMessage = `${provider} key removed.`;
  }

  async function beginOAuthLogin(provider: string) {
    settingsMessage = undefined;
    activeOAuthFlow = await startOAuthFlow(provider);
  }

  async function refreshOAuthFlow() {
    if (!activeOAuthFlow) return;
    activeOAuthFlow = await getOAuthFlow(activeOAuthFlow.flowId);
  }

  async function respondToOAuthSelection(selectedId: string) {
    if (!activeOAuthFlow?.promptId) return;
    activeOAuthFlow = await respondOAuthFlow(activeOAuthFlow.flowId, {
      promptId: activeOAuthFlow.promptId,
      selectedId,
    });
  }

  async function respondToOAuthPrompt() {
    if (!activeOAuthFlow?.promptId) return;
    const promptId = activeOAuthFlow.promptId;
    const value = oauthResponseDraft[promptId] ?? "";
    activeOAuthFlow = await respondOAuthFlow(activeOAuthFlow.flowId, {
      promptId,
      value,
    });
    oauthResponseDraft = { ...oauthResponseDraft, [promptId]: "" };
  }

  async function cancelOAuthLogin() {
    if (!activeOAuthFlow) return;
    activeOAuthFlow = await cancelOAuthFlow(activeOAuthFlow.flowId);
  }

  async function removeAuthCredential(provider: string) {
    await deleteAuthCredential(provider);
    providerKeys = await getProviderKeys();
    authProviders = await getAuthProviders();
    settingsMessage = `${provider} credentials removed.`;
  }

  function exportUrl(kind: "json" | "md" | "html"): string | undefined {
    if (!selection.sessionId) return undefined;
    const suffix = kind === "json" ? "export" : `export.${kind}`;
    return `/api/sessions/${selection.sessionId}/${suffix}`;
  }

  async function completeFiles(query: string): Promise<CompletionItem[]> {
    return queryClient.fetchQuery({
      queryKey: queryKeys.fileCompletions(selection.projectId, query),
      queryFn: () => getFileCompletions(selection.projectId, query),
      staleTime: 2_000,
    });
  }

  async function openSession(sessionId: string) {
    const session = sessions.find((candidate) => candidate.id === sessionId) ??
      (await apiGet<{ session: SessionRecord }>(`/api/sessions/${sessionId}`)).session;
    selection.sessionId = session.id;
    selection.projectId = session.projectId;
    selection.agentId = session.activeAgentId ?? agents.find((agent) => agent.sessionId === session.id)?.id;
    selection.entryId = session.activeEntryId;
    const project = projects.find((candidate) => candidate.id === session.projectId) ??
      (await apiGet<{ project: ProjectRecord }>(`/api/projects/${session.projectId}`)).project;
    composerDraft.projectDir = project.dir;
    const sessionAgent = agents.find((agent) => agent.id === selection.agentId);
    if (sessionAgent?.model) selectedModelKey = modelKey(sessionAgent.model);
    const [entries, tree] = await Promise.all([
      getSessionMessages(session.id),
      getSessionTree(session.id),
    ]);
    transcript = entriesToTranscript(entries);
    treeNodes = tree.nodes;
    selection.entryId = tree.activeEntryId;
    streamingText = "";
    sending = false;
    layout.inspectorTab = "session";
  }

  async function navigateToEntry(entryId: string | undefined, summarize = false) {
    if (!selection.sessionId) return;
    await apiPost(`/api/sessions/${selection.sessionId}/navigate`, {
      activeEntryId: entryId ?? null,
      summarize,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openSession(selection.sessionId);
    layout.inspectorTab = "branch";
  }

  async function compactActiveSession() {
    if (!selection.sessionId) return;
    await compactSession(selection.sessionId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openSession(selection.sessionId);
    layout.inspectorTab = "branch";
  }

  function newSession() {
    resetSelection();
    transcript = [];
    treeNodes = [];
    streamingText = "";
    sending = false;
    composerDraft.text = "";
    layout.inspectorTab = "session";
  }

  async function ensureAgent(): Promise<string> {
    if (selection.agentId) {
      const desired = selectedModel();
      if (desired && modelKey(activeAgent?.model ?? { provider: "", modelId: "" }) !== modelKey(desired)) {
        await updateAgentModel(selection.agentId, desired).catch(() => undefined);
      }
      return selection.agentId;
    }
    if (selection.projectId && selection.sessionId) {
      const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
        projectId: selection.projectId,
        sessionId: selection.sessionId,
        model: selectedModel(),
      });
      selection.agentId = agent.id;
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      await loadWorkspaceState();
      return agent.id;
    }
    const { project } = await apiPost<{ project: ProjectRecord }>(
      "/api/projects",
      { dir: composerDraft.projectDir || "." },
    );
    const { session } = await apiPost<{ session: SessionRecord }>(
      "/api/sessions",
      { projectId: project.id, title: `Workbench: ${project.name}` },
    );
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: project.id,
      sessionId: session.id,
      model: selectedModel(),
    });
    selection.projectId = project.id;
    selection.sessionId = session.id;
    selection.entryId = session.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = project.dir;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    return agent.id;
  }

  async function grantApproval(approvalId: string) {
    await apiPost(`/api/approvals/${approvalId}/grant`, {});
    approvals = await getPendingApprovals();
    layout.inspectorTab = "events";
  }

  async function selectProcess(processId: string) {
    selectedProcessId = processId;
    processLogs = await getProcessLogs(processId);
    layout.inspectorTab = "processes";
  }

  async function stopSelectedProcess(processId: string) {
    await stopProcess(processId);
    await loadWorkspaceState();
    if (selectedProcessId) processLogs = await getProcessLogs(selectedProcessId);
  }

  async function restartSelectedProcess(processId: string) {
    const restarted = await restartProcess(processId);
    selectedProcessId = restarted.id;
    await loadWorkspaceState();
    processLogs = await getProcessLogs(restarted.id);
  }

  async function refreshProcessLogs() {
    if (!selectedProcessId) return;
    processLogs = await getProcessLogs(selectedProcessId);
  }

  async function denyApproval(approvalId: string) {
    await apiPost(`/api/approvals/${approvalId}/deny`, { note: "Denied from UI." });
    approvals = await getPendingApprovals();
    layout.inspectorTab = "events";
  }

  async function abortActiveRun() {
    if (!selection.agentId) return;
    await apiPost(`/api/agents/${selection.agentId}/abort`, {});
    sending = false;
    streamingText = "";
  }

  async function sendPrompt() {
    const text = composerDraft.text.trim();
    if (!text || sending) return;
    if (text === "/abort") {
      composerDraft.text = "";
      await abortActiveRun();
      return;
    }
    sending = true;
    error = undefined;
    streamingText = "";
    transcript = [...transcript, { role: "user", text }];
    composerDraft.text = "";
    try {
      const agentId = await ensureAgent();
      await apiPost(`/api/agents/${agentId}/prompt`, { text });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      sending = false;
    }
  }

  function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
    pushEventPreview(JSON.stringify(event));
    const agentId = event.data?.agentId;
    if (agentId && agentId !== selection.agentId) return;
    if (event.type === "agent.message_delta") {
      streamingText += String(event.data?.delta ?? "");
    }
    if (event.type === "agent.message_complete") {
      const entry = event.data?.entry as { id?: string; text?: string } | undefined;
      const text = streamingText || entry?.text || String(event.data?.text ?? "");
      if (text) transcript = [...transcript, { id: entry?.id, role: "assistant", text }];
      selection.entryId = entry?.id ?? selection.entryId;
      streamingText = "";
      sending = false;
      if (selection.sessionId) void openSession(selection.sessionId);
    }
    if (event.type === "agent.error") {
      error = String(event.data?.message ?? "Agent error");
      sending = false;
    }
    if (event.type === "process.log") {
      const processId = String(event.data?.processId ?? "");
      if (processId && processId === selectedProcessId) void getProcessLogs(processId).then((logs) => (processLogs = logs));
      return;
    }
    if (
      event.type === "session.created" ||
      event.type === "session.compacted" ||
      event.type === "session.branch_summarized" ||
      event.type === "session.navigated" ||
      event.type === "agent.created" ||
      event.type === "agent.status_changed" ||
      event.type.startsWith("agent.subagent_") ||
      event.type === "project.created" ||
      event.type.startsWith("approval.") ||
      event.type.startsWith("agent.tool_call") ||
      event.type.startsWith("process.") ||
      event.type.startsWith("settings.") ||
      event.type.startsWith("secrets.") ||
      event.type.startsWith("auth.")
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      void loadWorkspaceState();
      if (event.type.startsWith("settings.") || event.type.startsWith("secrets.") || event.type.startsWith("auth.")) void loadSettingsPanel();
      if (event.type === "auth.oauth_flow_updated") {
        const flow = (event.data as { flow?: OAuthFlowInfo }).flow;
        if (flow && (!activeOAuthFlow || flow.flowId === activeOAuthFlow.flowId)) activeOAuthFlow = flow;
      }
    }
  }

  function setTheme(preference: ThemePreference) {
    applyTheme(preference);
  }

  onMount(() => {
    let themeMedia: MediaQueryList | undefined;
    const handleSystemTheme = () => applyTheme(themeState.preference);

    async function connect() {
      try {
        applyTheme(loadThemePreference());
        themeMedia = window.matchMedia("(prefers-color-scheme: light)");
        themeMedia.addEventListener("change", handleSystemTheme);
        config = await getClientConfig();
        status = config.status;
        composerDraft.projectDir = config.status.storage.home;
        await Promise.all([loadWorkspaceState(), loadSlashCommands()]);
        await loadSettingsPanel();

        socket = new WebSocket(new URL(config.wsUrl));
        socket.addEventListener("open", () => {
          connection = "live";
        });
        socket.addEventListener("message", (message) => {
          const parsed = JSON.parse(String(message.data)) as EventEnvelope<Record<string, unknown>>;
          if (parsed.type) handleEvent(parsed);
        });
        socket.addEventListener("close", () => {
          connection = "closed";
        });
        socket.addEventListener("error", () => {
          connection = "error";
        });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        connection = "error";
      }
    }

    connect();
    return () => {
      socket?.close();
      themeMedia?.removeEventListener("change", handleSystemTheme);
    };
  });
</script>

<svelte:head>
  <title>Nerve Workbench</title>
</svelte:head>

<main class="app-shell">
  <div class="ambient-grid"></div>
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark">N</div>
      <div>
        <p class="eyebrow">local orchestrator</p>
        <h1>Nerve Workbench</h1>
      </div>
    </div>

    <div class="topbar-actions">
      {#if pendingApprovalCount > 0}
        <Badge tone="warn">{pendingApprovalCount} approval{pendingApprovalCount === 1 ? "" : "s"}</Badge>
      {/if}
      <Badge tone={live ? "good" : "warn"}>
        <span class="status-dot" class:live></span>{connection}
      </Badge>
      <div class="theme-switch" aria-label="Theme preference">
        {#each ["system", "light", "dark"] as theme}
          <button
            class:active={themeState.preference === theme}
            type="button"
            onclick={() => setTheme(theme as ThemePreference)}
          >{theme}</button>
        {/each}
      </div>
    </div>
  </header>

  <PaneGroup direction="horizontal" class="workbench-panes">
    <Pane defaultSize={23} minSize={16} class="pane-shell sidebar-pane">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div>
            <p class="eyebrow">sessions</p>
            <h2>Run archive</h2>
          </div>
          <Button variant="ghost" size="sm" onclick={newSession}>New</Button>
        </div>

        {#if sessions.length > 0}
          <div class="session-list">
            {#each sessions as session}
              <button
                class="session-card"
                class:active={session.id === selection.sessionId}
                type="button"
                onclick={() => openSession(session.id)}
              >
                <span>{session.title}</span>
                <small>{session.id}</small>
                <em>{new Date(session.updatedAt).toLocaleString()}</em>
              </button>
            {/each}
          </div>
        {:else}
          <Card tone="muted" class="empty-card">
            <p>No durable sessions yet. Start from the composer.</p>
          </Card>
        {/if}
      </aside>
    </Pane>

    <PaneResizer class="pane-resizer" />

    <Pane defaultSize={52} minSize={34} class="pane-shell conversation-pane">
      <section class="conversation-column">
        <div class="conversation-header">
          <div>
            <p class="eyebrow">conversation</p>
            <h2>{activeSession?.title ?? "Unstarted session"}</h2>
          </div>
          <div class="conversation-meta">
            <Badge tone="accent">{activeAgent?.mode ?? "coding"}</Badge>
            <Badge>{activeAgent?.permissionLevel ?? "supervised"}</Badge>
          </div>
        </div>

        <div class="conversation-scroll">
          {#if transcript.length === 0 && !streamingText}
            <div class="empty-conversation">
              <span>◆</span>
              <h3>Ready for a local run</h3>
              <p>Pick a previous branch or send a prompt. Use <code>/</code> for commands and <code>@</code> for project files.</p>
            </div>
          {/if}

          {#each transcript as item}
            <article class="message" class:user={item.role === "user"} class:system={item.role === "system"}>
              <div class="message-rail">{item.role === "user" ? "you" : item.role === "system" ? "ctx" : "ai"}</div>
              <div class="message-body">
                {#if item.role === "assistant" || item.role === "system"}
                  {#if item.kind && item.kind !== "message"}<Badge tone="accent">{item.kind.replace("_", " ")}</Badge>{/if}
                  <Markdown text={item.text} />
                {:else}
                  <p>{item.text}</p>
                {/if}
              </div>
            </article>
          {/each}

          {#if streamingText}
            <article class="message streaming">
              <div class="message-rail">ai</div>
              <div class="message-body"><p>{streamingText}</p></div>
            </article>
          {/if}
        </div>

        <form class="composer-panel" onsubmit={(event) => { event.preventDefault(); sendPrompt(); }}>
          <label>
            <span>Project directory</span>
            <Input bind:value={composerDraft.projectDir} placeholder="/path/to/project" disabled={sending} />
          </label>
          <div class="composer-label">
            <span>Prompt</span>
            <CodeMirrorComposer
              value={composerDraft.text}
              disabled={sending || !live}
              {slashCompletions}
              fileCompletions={completeFiles}
              onChange={(value) => (composerDraft.text = value)}
              onSubmit={sendPrompt}
            />
          </div>
          <div class="composer-actions">
            <Button disabled={sending || !live} type="submit" size="lg">
              {sending ? "Streaming…" : "Send prompt"}
            </Button>
            <Button disabled={!sending} variant="secondary" onclick={abortActiveRun}>Abort</Button>
          </div>
          {#if error}<p class="error">{error}</p>{/if}
        </form>
      </section>
    </Pane>

    <PaneResizer class="pane-resizer" />

    <Pane defaultSize={25} minSize={18} class="pane-shell inspector-pane">
      <aside class="inspector">
        <Tabs.Root
          value={layout.inspectorTab}
          onValueChange={(value) => (layout.inspectorTab = value as InspectorTab)}
          class="inspector-tabs"
        >
          <Tabs.List class="tab-list">
            <Tabs.Trigger value="session" class="tab-trigger">Session</Tabs.Trigger>
            <Tabs.Trigger value="branch" class="tab-trigger">Branch</Tabs.Trigger>
            <Tabs.Trigger value="approvals" class="tab-trigger">Approvals</Tabs.Trigger>
            <Tabs.Trigger value="processes" class="tab-trigger">Processes</Tabs.Trigger>
            <Tabs.Trigger value="settings" class="tab-trigger">Settings</Tabs.Trigger>
            <Tabs.Trigger value="events" class="tab-trigger">Events</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="session" class="tab-content">
            <Card tone="muted" class="detail-card">
              <h3>Daemon</h3>
              <dl>
                <dt>ID</dt><dd>{status?.daemonId ?? "loading"}</dd>
                <dt>Data</dt><dd>{status?.dataDir ?? "—"}</dd>
                <dt>Index</dt><dd>{status?.storage.indexHealthy ? "healthy" : "unknown"}</dd>
              </dl>
            </Card>
            <Card tone="muted" class="detail-card">
              <h3>Active records</h3>
              <dl>
                <dt>Project</dt><dd>{activeProject?.name ?? "not selected"}</dd>
                <dt>Session</dt><dd>{selection.sessionId ?? "not started"}</dd>
                <dt>Agent</dt><dd>{selection.agentId ?? "not started"}</dd>
              </dl>
            </Card>
            <Card tone="muted" class="detail-card">
              <h3>Agent tree</h3>
              {#if sessionAgents.length > 0}
                <div class="agent-tree">
                  {#each sessionAgents as agent}
                    <button
                      class="agent-node"
                      class:active={agent.id === selection.agentId}
                      style={`--agent-depth: ${agent.budget.depth}`}
                      type="button"
                      onclick={() => selectAgent(agent)}
                    >
                      <strong>{agentLabel(agent)} · {agent.status}</strong>
                      <span>{agent.mode} / {agent.permissionLevel}</span>
                      <small>{agent.id}</small>
                      {#if agent.parentAgentId}<em>parent {agent.parentAgentId}</em>{/if}
                    </button>
                  {/each}
                </div>
              {:else}
                <p class="muted">No agents in this session yet.</p>
              {/if}
            </Card>
          </Tabs.Content>

          <Tabs.Content value="branch" class="tab-content">
            <div class="branch-header">
              <div>
                <p class="eyebrow">active path</p>
                <h3>{branchDepth} entries</h3>
              </div>
              <div class="branch-actions">
                <Button variant="ghost" size="sm" onclick={compactActiveSession}>Compact</Button>
                <Button variant="ghost" size="sm" onclick={() => navigateToEntry(undefined, true)}>Root + summarize</Button>
                <Button variant="ghost" size="sm" onclick={() => navigateToEntry(undefined)}>Root</Button>
              </div>
            </div>
            {#if treeNodes.length > 0}
              <div class="branch-list">
                {#each treeNodes as node}
                  <button
                    class="branch-node"
                    class:active={node.entry.id === selection.entryId}
                    type="button"
                    onclick={() => navigateToEntry(node.entry.id)}
                  >
                    <strong>{node.entry.kind && node.entry.kind !== "message" ? node.entry.kind.replace("_", " ") : node.entry.role}</strong>
                    <span>{node.entry.text.slice(0, 120) || node.entry.id}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <p class="muted">No branch metadata loaded.</p>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="approvals" class="tab-content">
            {#if approvals.length > 0}
              <div class="approval-list">
                {#each approvals as approval}
                  <Card tone="muted" class="approval-card">
                    <div class="approval-heading">
                      <div>
                        <p class="eyebrow">{approval.risk}</p>
                        <h3>{approval.toolCall?.toolName ?? "tool call"}</h3>
                      </div>
                      <Badge tone="warn">pending</Badge>
                    </div>
                    <p>{approval.reason}</p>
                    {#if approval.toolCall}
                      <code>{JSON.stringify(approval.toolCall.args, null, 2)}</code>
                    {/if}
                    <div class="approval-actions">
                      <Button size="sm" onclick={() => grantApproval(approval.id)}>Approve</Button>
                      <Button size="sm" variant="secondary" onclick={() => denyApproval(approval.id)}>Deny</Button>
                    </div>
                  </Card>
                {/each}
              </div>
            {:else}
              <p class="muted">No pending approvals.</p>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="processes" class="tab-content">
            <div class="branch-header">
              <div>
                <p class="eyebrow">background</p>
                <h3>{processes.length} processes</h3>
              </div>
              <Button variant="ghost" size="sm" onclick={refreshProcessLogs}>Refresh</Button>
            </div>
            {#if processes.length > 0}
              <div class="process-layout">
                <div class="process-list">
                  {#each processes as process}
                    <button
                      class="process-card"
                      class:active={process.id === selectedProcessId}
                      type="button"
                      onclick={() => selectProcess(process.id)}
                    >
                      <strong>{process.name ?? process.command}</strong>
                      <span>{process.status}</span>
                      <small>{process.id}</small>
                    </button>
                  {/each}
                </div>
                {#if selectedProcess}
                  <Card tone="muted" class="detail-card process-detail">
                    <div class="approval-heading">
                      <div>
                        <p class="eyebrow">{selectedProcess.status}</p>
                        <h3>{selectedProcess.name ?? selectedProcess.id}</h3>
                      </div>
                      <Badge tone={selectedProcess.status === "ready" || selectedProcess.status === "running" ? "good" : "warn"}>{selectedProcess.status}</Badge>
                    </div>
                    <dl>
                      <dt>Command</dt><dd>{selectedProcess.command}</dd>
                      <dt>CWD</dt><dd>{selectedProcess.cwd}</dd>
                      <dt>Ready</dt><dd>{selectedProcess.readiness.outcome}{selectedProcess.readiness.matched ? ` · ${selectedProcess.readiness.matched}` : ""}</dd>
                    </dl>
                    <div class="approval-actions">
                      <Button size="sm" variant="secondary" onclick={() => stopSelectedProcess(selectedProcess.id)}>Stop</Button>
                      <Button size="sm" onclick={() => restartSelectedProcess(selectedProcess.id)}>Restart</Button>
                    </div>
                  </Card>
                {/if}
                {#if processLogs?.events.length}
                  <div class="process-log-list">
                    {#each processLogs.events as log}
                      <code class:error-line={log.level === "error"} class:warn-line={log.level === "warn"}>
                        {log.seq} {log.stream} {log.line}
                      </code>
                    {/each}
                  </div>
                {:else}
                  <p class="muted">No captured logs for the selected process.</p>
                {/if}
              </div>
            {:else}
              <p class="muted">No supervised background processes yet. Agents can create one with <code>process_start</code>.</p>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="settings" class="tab-content">
            <div class="branch-header">
              <div>
                <p class="eyebrow">polish</p>
                <h3>Settings & exports</h3>
              </div>
              <Button variant="ghost" size="sm" onclick={loadSettingsPanel}>Refresh</Button>
            </div>
            {#if settingsDraft}
              <Card tone="muted" class="detail-card settings-card">
                <h3>Defaults</h3>
                <label>Mode
                  <select bind:value={settingsDraft.defaultMode}>
                    <option value="planning">planning</option>
                    <option value="coding">coding</option>
                  </select>
                </label>
                <label>Permission
                  <select bind:value={settingsDraft.defaultPermissionLevel}>
                    <option value="read_only">read only</option>
                    <option value="supervised">supervised</option>
                    <option value="autonomous">autonomous</option>
                  </select>
                </label>
                <label><input type="checkbox" bind:checked={settingsDraft.compaction.auto} /> Auto-compact sessions</label>
                <label><input type="checkbox" bind:checked={settingsDraft.server.allowRemote} /> Allow remote daemon bind after restart</label>
                <Button size="sm" onclick={saveSettings}>Save settings</Button>
              </Card>
            {/if}
            <Card tone="muted" class="detail-card settings-card">
              <h3>Model picker</h3>
              <select bind:value={selectedModelKey}>
                {#each models as model}
                  <option value={modelKey(model)}>{model.label}</option>
                {/each}
              </select>
              <Button size="sm" disabled={!selection.agentId} onclick={saveActiveModel}>Apply to active agent</Button>
              <p class="muted">New agents use this model. Existing agents can be updated while idle.</p>
            </Card>
            <Card tone="muted" class="detail-card settings-card">
              <h3>Authentication</h3>
              {#if authProviders.length > 0}
                {#each authProviders as provider}
                  <div class="provider-key-row">
                    <div>
                      <strong>{provider.displayName}</strong>
                      <small>{provider.provider} · {provider.configured ? provider.credentialType : "missing"}</small>
                      {#if provider.warning}<small class="warning-text">{provider.warning}</small>{/if}
                    </div>
                    {#if provider.supportsOAuth}
                      <Button size="sm" onclick={() => beginOAuthLogin(provider.provider)}>Use subscription</Button>
                    {/if}
                    <Button size="sm" variant="secondary" disabled={!provider.configured} onclick={() => removeAuthCredential(provider.provider)}>Remove</Button>
                  </div>
                {/each}
              {:else}
                <p class="muted">No authentication providers are available.</p>
              {/if}
              {#if activeOAuthFlow}
                <div class="oauth-flow-panel">
                  <strong>{activeOAuthFlow.providerName}</strong>
                  <small>{activeOAuthFlow.status} · {activeOAuthFlow.message}</small>
                  {#if activeOAuthFlow.error}<p class="warning-text">{activeOAuthFlow.error}</p>{/if}
                  {#if activeOAuthFlow.status === "select" && activeOAuthFlow.options}
                    <div class="oauth-actions">
                      {#each activeOAuthFlow.options as option}
                        <Button size="sm" onclick={() => respondToOAuthSelection(option.id)}>{option.label}</Button>
                      {/each}
                    </div>
                  {/if}
                  {#if activeOAuthFlow.status === "auth_url"}
                    {#if activeOAuthFlow.authUrl}<a href={activeOAuthFlow.authUrl} target="_blank" rel="noreferrer">Open login URL</a>{/if}
                    {#if activeOAuthFlow.instructions}<p class="muted">{activeOAuthFlow.instructions}</p>{/if}
                    {#if activeOAuthFlow.promptId}
                      <Input bind:value={oauthResponseDraft[activeOAuthFlow.promptId]} placeholder={activeOAuthFlow.placeholder ?? "paste redirect URL"} />
                      <Button size="sm" onclick={respondToOAuthPrompt}>Submit code</Button>
                    {/if}
                  {/if}
                  {#if activeOAuthFlow.status === "device_code" && activeOAuthFlow.deviceCode}
                    <p class="muted">Open <a href={activeOAuthFlow.deviceCode.verificationUri} target="_blank" rel="noreferrer">{activeOAuthFlow.deviceCode.verificationUri}</a> and enter:</p>
                    <code>{activeOAuthFlow.deviceCode.userCode}</code>
                  {/if}
                  {#if activeOAuthFlow.status === "prompt" && activeOAuthFlow.promptId}
                    <Input bind:value={oauthResponseDraft[activeOAuthFlow.promptId]} placeholder={activeOAuthFlow.placeholder ?? "response"} />
                    <Button size="sm" onclick={respondToOAuthPrompt}>Submit</Button>
                  {/if}
                  {#if activeOAuthFlow.status !== "succeeded" && activeOAuthFlow.status !== "failed" && activeOAuthFlow.status !== "cancelled"}
                    <Button size="sm" variant="secondary" onclick={cancelOAuthLogin}>Cancel</Button>
                    <Button size="sm" variant="ghost" onclick={refreshOAuthFlow}>Refresh</Button>
                  {/if}
                </div>
              {/if}
            </Card>
            <Card tone="muted" class="detail-card settings-card">
              <h3>API keys</h3>
              {#if providerKeys.length > 0}
                {#each providerKeys as key}
                  <div class="provider-key-row">
                    <div>
                      <strong>{key.provider}</strong>
                      <small>{key.envVar} · {key.configured ? "configured" : "missing"}</small>
                    </div>
                    <Input type="password" bind:value={providerKeyDraft[key.provider]} placeholder="paste key" />
                    <Button size="sm" onclick={() => saveProviderKey(key.provider)}>Save</Button>
                    <Button size="sm" variant="secondary" disabled={!key.configured} onclick={() => removeProviderKey(key.provider)}>Remove</Button>
                  </div>
                {/each}
              {:else}
                <p class="muted">No external providers are reported by the installed model package.</p>
              {/if}
            </Card>
            <Card tone="muted" class="detail-card settings-card">
              <h3>Session export</h3>
              {#if selection.sessionId}
                <div class="export-actions">
                  <a href={exportUrl("json")}>JSON bundle</a>
                  <a href={exportUrl("md")}>Markdown</a>
                  <a href={exportUrl("html")}>HTML</a>
                </div>
              {:else}
                <p class="muted">Select a session to export it.</p>
              {/if}
            </Card>
            {#if settingsMessage}<p class="muted">{settingsMessage}</p>{/if}
          </Tabs.Content>

          <Tabs.Content value="events" class="tab-content">
            {#if eventBuffer.items.length > 0}
              <div class="event-list">
                {#each eventBuffer.items as event}
                  <code>{event}</code>
                {/each}
              </div>
            {:else}
              <p class="muted">Waiting for WebSocket events…</p>
            {/if}
          </Tabs.Content>
        </Tabs.Root>
      </aside>
    </Pane>
  </PaneGroup>
</main>

<style>
  .app-shell {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    padding: clamp(1rem, 2vw, 1.5rem);
    background:
      radial-gradient(circle at 18% 8%, var(--color-aurora-a), transparent 26rem),
      radial-gradient(circle at 78% 0%, var(--color-aurora-b), transparent 24rem),
      linear-gradient(135deg, var(--color-bg), var(--color-bg-deep));
  }

  .ambient-grid {
    pointer-events: none;
    position: absolute;
    inset: 0;
    opacity: var(--grid-opacity);
    background-image:
      linear-gradient(var(--color-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--color-grid) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(circle at 50% 20%, black, transparent 72%);
  }

  .topbar,
  :global(.workbench-panes) {
    position: relative;
    z-index: 1;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 auto 1rem;
    width: min(1680px, 100%);
  }

  .brand-lockup,
  .topbar-actions,
  .conversation-meta,
  .composer-actions,
  .branch-header,
  .branch-actions,
  .approval-heading,
  .approval-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .branch-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .brand-mark {
    display: grid;
    width: 3.25rem;
    height: 3.25rem;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: 1.1rem;
    background: var(--gradient-accent);
    color: var(--color-accent-ink);
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 900;
    box-shadow: var(--shadow-glow);
  }

  .eyebrow {
    margin: 0 0 0.25rem;
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    font-weight: 900;
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 0;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 3vw, 2.4rem);
    letter-spacing: -0.06em;
  }

  h2,
  h3 {
    margin-bottom: 0;
    letter-spacing: -0.035em;
  }

  .theme-switch {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-muted);
    padding: 0.2rem;
  }

  .theme-switch button {
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    cursor: pointer;
  }

  .theme-switch button.active {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: currentColor;
  }

  .status-dot.live {
    box-shadow: 0 0 18px var(--color-good);
  }

  :global(.workbench-panes) {
    width: min(1680px, 100%);
    height: calc(100vh - 6.25rem);
    min-height: 680px;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 1.8rem;
    background: var(--color-shell);
    box-shadow: var(--shadow-elevated);
  }

  :global(.pane-shell) {
    min-width: 0;
  }

  :global(.pane-resizer) {
    position: relative;
    width: 0.5rem;
    background: transparent;
  }

  :global(.pane-resizer)::after {
    content: "";
    position: absolute;
    inset: 1rem 0.18rem;
    border-radius: 999px;
    background: var(--color-border-subtle);
    transition: background 140ms ease;
  }

  :global(.pane-resizer):hover::after {
    background: var(--color-accent);
  }

  .sidebar,
  .inspector,
  .conversation-column {
    height: 100%;
    min-height: 0;
  }

  .sidebar,
  .inspector {
    padding: 1rem;
    background: var(--color-panel-muted);
  }

  .sidebar-header,
  .conversation-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .session-list,
  .branch-list,
  .agent-tree,
  .event-list {
    display: grid;
    gap: 0.65rem;
  }

  .session-card,
  .branch-node,
  .agent-node {
    display: grid;
    width: 100%;
    gap: 0.28rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.78rem;
    text-align: left;
    cursor: pointer;
  }

  .agent-node {
    margin-left: calc(var(--agent-depth, 0) * 0.8rem);
    width: calc(100% - (var(--agent-depth, 0) * 0.8rem));
  }

  .session-card:hover,
  .branch-node:hover,
  .agent-node:hover,
  .session-card.active,
  .branch-node.active,
  .agent-node.active {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .session-card small,
  .session-card em,
  .branch-node span,
  .agent-node span,
  .agent-node small,
  .agent-node em,
  .muted {
    color: var(--color-muted);
  }

  .session-card small,
  .branch-node span,
  .agent-node small,
  .agent-node em,
  dd,
  code {
    overflow-wrap: anywhere;
  }

  .session-card em {
    font-size: 0.72rem;
    font-style: normal;
  }

  :global(.empty-card) {
    padding: 1rem;
  }

  .conversation-column {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: color-mix(in oklab, var(--color-bg), transparent 8%);
  }

  .conversation-header {
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 1.1rem 1.25rem;
    margin-bottom: 0;
  }

  .conversation-scroll {
    min-height: 0;
    overflow: auto;
    padding: 1.25rem;
  }

  .empty-conversation {
    display: grid;
    min-height: 100%;
    place-items: center;
    align-content: center;
    color: var(--color-muted);
    text-align: center;
  }

  .empty-conversation span {
    color: var(--color-accent);
    font-size: 2rem;
  }

  .empty-conversation h3 {
    color: var(--color-text);
  }

  .empty-conversation code {
    display: inline;
    padding: 0.1rem 0.3rem;
  }

  .message {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 0.9rem;
    margin-bottom: 1rem;
  }

  .message-rail {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: 0.8rem;
    background: var(--color-panel-muted);
    color: var(--color-muted);
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .message-body {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    padding: 1rem;
    box-shadow: var(--shadow-message);
  }

  .message.user .message-body {
    background: var(--color-user-message);
  }

  .message.system .message-body {
    border-style: dashed;
    background: var(--color-panel-muted);
  }

  .message.system .message-rail {
    color: var(--color-accent);
  }

  .message.streaming .message-body {
    border-color: var(--color-accent);
  }

  .message-body p {
    margin-bottom: 0;
    color: var(--color-message-text);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .composer-panel {
    display: grid;
    gap: 0.85rem;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 1rem 1.25rem 1.15rem;
  }

  label,
  .composer-label {
    display: grid;
    gap: 0.45rem;
    color: var(--color-muted);
    font-size: 0.86rem;
    font-weight: 700;
  }

  .error {
    margin: 0;
    color: var(--color-danger);
  }

  :global(.inspector-tabs) {
    display: grid;
    height: 100%;
    grid-template-rows: auto minmax(0, 1fr);
  }

  :global(.tab-list) {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.25rem;
    margin-bottom: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-field);
    padding: 0.22rem;
  }

  :global(.tab-trigger) {
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    padding: 0.48rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 900;
    cursor: pointer;
  }

  :global(.tab-trigger[data-state="active"]) {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.tab-content) {
    min-height: 0;
    overflow: auto;
  }

  :global(.detail-card),
  :global(.approval-card) {
    margin-bottom: 0.75rem;
    padding: 1rem;
  }

  .approval-list,
  .process-layout,
  .process-list,
  .process-log-list,
  :global(.settings-card),
  .provider-key-row,
  .export-actions {
    display: grid;
    gap: 0.75rem;
  }

  :global(.settings-card) label,
  .provider-key-row {
    color: var(--color-muted);
    font-size: 0.82rem;
  }

  :global(.settings-card) select {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.65rem 0.75rem;
  }

  .provider-key-row {
    grid-template-columns: minmax(0, 1fr) minmax(8rem, 1fr) auto auto;
    align-items: end;
  }

  .provider-key-row small {
    display: block;
    color: var(--color-faint);
  }

  .warning-text {
    color: var(--color-warning);
  }

  .oauth-flow-panel,
  .oauth-actions {
    display: grid;
    gap: 0.6rem;
  }

  .oauth-flow-panel {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: 0.8rem;
  }

  .export-actions {
    grid-template-columns: repeat(3, 1fr);
  }

  .export-actions a {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.72rem;
    text-align: center;
    text-decoration: none;
    font-weight: 800;
  }

  .process-card {
    display: grid;
    gap: 0.25rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.72rem;
    text-align: left;
    cursor: pointer;
  }

  .process-card.active,
  .process-card:hover {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .process-card span,
  .process-card small {
    color: var(--color-muted);
  }

  .process-log-list code.error-line {
    border-color: color-mix(in oklab, var(--color-danger), transparent 45%);
    color: var(--color-danger);
  }

  .process-log-list code.warn-line {
    border-color: color-mix(in oklab, var(--color-warn), transparent 45%);
    color: var(--color-warn);
  }

  .approval-heading {
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .approval-actions {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.5rem 0.8rem;
    margin: 0.75rem 0 0;
    font-size: 0.86rem;
  }

  dt {
    color: var(--color-muted);
  }

  dd {
    margin: 0;
  }

  code {
    display: block;
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-code);
    padding: 0.72rem;
    font-size: 0.75rem;
  }

  @media (max-width: 980px) {
    :global(.workbench-panes) {
      display: block;
      height: auto;
      min-height: 0;
    }

    :global(.sidebar-pane),
    :global(.conversation-pane),
    :global(.inspector-pane) {
      display: block !important;
      width: 100% !important;
    }

    :global(.pane-resizer) {
      display: none;
    }

    .conversation-column {
      min-height: 680px;
    }
  }
</style>
