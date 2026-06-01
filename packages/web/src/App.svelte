<script lang="ts">
  import { onMount } from "svelte";
  import { Pane, PaneGroup, PaneResizer } from "paneforge";
  import { toast } from "svelte-sonner";
  import type { ThemePreference } from "./lib/state/app-state.svelte";
  import {
    applyTheme,
    composerDraft,
    eventBuffer,
    loadThemePreference,
    pushEventPreview,
    resetSelection,
    selection,
    themeState,
  } from "./lib/state/app-state.svelte";
  import {
    apiGet,
    apiPost,
    compactSession,
    getAuthProviders,
    getClientConfig,
    getFileCompletions,
    getModels,
    getPendingApprovals,
    getProcessLogs,
    getSessionMessages,
    getSessionTree,
    getSettings,
    getSlashCompletions,
    getWorkspaceSnapshot,
    type AgentRecord,
    type ApprovalWithToolCall,
    type AuthProviderMetadata,
    type ClientConfig,
    type CompletionItem,
    type EventEnvelope,
    type ModelInfo,
    type ModelSelection,
    type ProcessLogQueryResponse,
    type ProcessRecord,
    type ProjectRecord,
    type SessionEntry,
    type SessionRecord,
    type SessionTreeNode,
    type Settings,
    type StatusResponse,
    restartProcess,
    stopProcess,
    updateAgentConfig,
    updateAgentModel,
    updateSettings,
  } from "./lib/api";
  import { queryClient, queryKeys } from "./lib/query";
  import ConversationPane from "./lib/components/app/ConversationPane.svelte";
  import ProjectAgentTree from "./lib/components/app/ProjectAgentTree.svelte";
  import ProjectDirectoryPicker from "./lib/components/app/ProjectDirectoryPicker.svelte";
  import Titlebar from "./lib/components/app/Titlebar.svelte";
  import UtilityPanel from "./lib/components/app/UtilityPanel.svelte";

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
  let selectedMode = $state<AgentRecord["mode"]>("coding");
  let selectedPermissionLevel = $state<AgentRecord["permissionLevel"]>("supervised");
  let utilityPanelOpen = $state(false);
  let utilityTab = $state<"history" | "approvals" | "processes" | "settings" | "events" | "info">("history");
  let projectPickerOpen = $state(false);
  let settingsDraft = $state<Settings | undefined>(undefined);
  let authProviders = $state<AuthProviderMetadata[]>([]);
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
  const usableModels = $derived(usableModelOptions(models, authProviders));

  function usableModelOptions(modelList: ModelInfo[], providers: AuthProviderMetadata[]): ModelInfo[] {
    const configuredProviders = new Set(
      providers.filter((provider) => provider.configured).map((provider) => provider.provider),
    );
    return modelList.filter((model) => model.faux || configuredProviders.has(model.provider));
  }

  function selectAgent(agent: AgentRecord) {
    selection.agentId = agent.id;
    selection.projectId = agent.projectId;
    selection.sessionId = agent.sessionId;
    utilityTab = "info";
    utilityPanelOpen = true;
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
    const [settings, modelList, auth] = await Promise.all([
      getSettings(),
      getModels(),
      getAuthProviders(),
    ]);
    settingsDraft = settings;
    models = modelList;
    authProviders = auth;
    selectedMode = activeAgent?.mode ?? settings.defaultMode;
    selectedPermissionLevel = activeAgent?.permissionLevel ?? settings.defaultPermissionLevel;
    const usable = usableModelOptions(modelList, auth);
    const activeModel = activeAgent?.model;
    if (activeModel && usable.some((model) => modelKey(model) === modelKey(activeModel))) {
      selectedModelKey = modelKey(activeModel);
    } else if (!usable.some((model) => modelKey(model) === selectedModelKey)) {
      selectedModelKey = usable.length > 0 ? modelKey(usable[0]) : "";
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
    try {
      settingsDraft = await updateSettings(settingsDraft);
      settingsMessage = "Settings saved. Server host/port changes apply after daemon restart.";
      toast.success("Settings saved", { description: "Host/port changes apply after daemon restart." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      settingsMessage = message;
      toast.error("Could not save settings", { description: message });
    }
  }

  async function saveActiveModel() {
    if (!selection.agentId) return;
    const agent = await updateAgentModel(selection.agentId, selectedModel());
    agents = agents.map((candidate) => candidate.id === agent.id ? agent : candidate);
    settingsMessage = "Agent model updated.";
    toast.success("Agent model updated");
  }

  async function setComposerModel(key: string) {
    selectedModelKey = key;
    if (!selection.agentId) return;
    const agent = await updateAgentConfig(selection.agentId, { model: selectedModel() ?? null });
    agents = agents.map((candidate) => candidate.id === agent.id ? agent : candidate);
  }

  async function setComposerMode(mode: AgentRecord["mode"]) {
    selectedMode = mode;
    if (!selection.agentId) return;
    const agent = await updateAgentConfig(selection.agentId, { mode });
    agents = agents.map((candidate) => candidate.id === agent.id ? agent : candidate);
  }

  async function setComposerPermission(permissionLevel: AgentRecord["permissionLevel"]) {
    selectedPermissionLevel = permissionLevel;
    if (!selection.agentId) return;
    const agent = await updateAgentConfig(selection.agentId, { permissionLevel });
    agents = agents.map((candidate) => candidate.id === agent.id ? agent : candidate);
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
    selectedMode = sessionAgent?.mode ?? session.mode;
    selectedPermissionLevel = sessionAgent?.permissionLevel ?? session.permissionLevel;
    const [entries, tree] = await Promise.all([
      getSessionMessages(session.id),
      getSessionTree(session.id),
    ]);
    transcript = entriesToTranscript(entries);
    treeNodes = tree.nodes;
    selection.entryId = tree.activeEntryId;
    streamingText = "";
    sending = false;
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
    utilityTab = "history";
    utilityPanelOpen = true;
  }

  async function compactActiveSession() {
    if (!selection.sessionId) return;
    await compactSession(selection.sessionId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openSession(selection.sessionId);
    utilityTab = "history";
    utilityPanelOpen = true;
  }

  function clearConversationState() {
    resetSelection();
    transcript = [];
    treeNodes = [];
    streamingText = "";
    sending = false;
    composerDraft.text = "";
  }

  function newSession() {
    clearConversationState();
    projectPickerOpen = true;
  }

  async function createConversationForDirectory(dir: string) {
    error = undefined;
    try {
      const { project } = await apiPost<{ project: ProjectRecord }>("/api/projects", { dir });
      const { session } = await apiPost<{ session: SessionRecord }>("/api/sessions", {
        projectId: project.id,
        title: project.name,
        mode: selectedMode,
        permissionLevel: selectedPermissionLevel,
      });
      const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
        projectId: project.id,
        sessionId: session.id,
        model: selectedModel(),
        mode: selectedMode,
        permissionLevel: selectedPermissionLevel,
      });
      selection.projectId = project.id;
      selection.sessionId = session.id;
      selection.entryId = session.activeEntryId;
      selection.agentId = agent.id;
      composerDraft.projectDir = project.dir;
      transcript = [];
      treeNodes = [];
      streamingText = "";
      sending = false;
      projectPickerOpen = false;
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      await loadWorkspaceState();
      await openSession(session.id);
      toast.success("Project opened", { description: project.dir });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      error = message;
      toast.error("Could not open project", { description: message });
    }
  }

  async function ensureAgent(): Promise<string> {
    if (selection.agentId) {
      const desired = selectedModel();
      const needsModel = desired && modelKey(activeAgent?.model ?? { provider: "", modelId: "" }) !== modelKey(desired);
      const needsMode = activeAgent?.mode !== selectedMode;
      const needsPermission = activeAgent?.permissionLevel !== selectedPermissionLevel;
      if (needsModel || needsMode || needsPermission) {
        const agent = await updateAgentConfig(selection.agentId, {
          model: desired ?? null,
          mode: selectedMode,
          permissionLevel: selectedPermissionLevel,
        }).catch(() => undefined);
        if (agent) agents = agents.map((candidate) => candidate.id === agent.id ? agent : candidate);
      }
      return selection.agentId;
    }
    if (selection.projectId && selection.sessionId) {
      const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
        projectId: selection.projectId,
        sessionId: selection.sessionId,
        model: selectedModel(),
        mode: selectedMode,
        permissionLevel: selectedPermissionLevel,
      });
      selection.agentId = agent.id;
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      await loadWorkspaceState();
      return agent.id;
    }
    projectPickerOpen = true;
    throw new Error("Select a project directory before starting a conversation.");
  }

  async function grantApproval(approvalId: string) {
    await apiPost(`/api/approvals/${approvalId}/grant`, {});
    approvals = await getPendingApprovals();
    utilityTab = "events";
    utilityPanelOpen = true;
    toast.success("Approval granted");
  }

  async function selectProcess(processId: string) {
    selectedProcessId = processId;
    processLogs = await getProcessLogs(processId);
    utilityTab = "processes";
    utilityPanelOpen = true;
  }

  async function stopSelectedProcess(processId: string) {
    await stopProcess(processId);
    await loadWorkspaceState();
    if (selectedProcessId) processLogs = await getProcessLogs(selectedProcessId);
    toast.success("Process stopped");
  }

  async function restartSelectedProcess(processId: string) {
    const restarted = await restartProcess(processId);
    selectedProcessId = restarted.id;
    await loadWorkspaceState();
    processLogs = await getProcessLogs(restarted.id);
    toast.success("Process restarted", { description: restarted.name ?? restarted.id });
  }

  async function refreshProcessLogs() {
    if (!selectedProcessId) return;
    processLogs = await getProcessLogs(selectedProcessId);
  }

  async function denyApproval(approvalId: string) {
    await apiPost(`/api/approvals/${approvalId}/deny`, { note: "Denied from UI." });
    approvals = await getPendingApprovals();
    utilityTab = "events";
    utilityPanelOpen = true;
    toast.message("Approval denied");
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
    if (!selection.projectId || !selection.sessionId) {
      projectPickerOpen = true;
      error = "Select a project directory before starting a conversation.";
      return;
    }
    if (usableModels.length === 0) {
      utilityPanelOpen = true;
      utilityTab = "settings";
      error = "Configure a model provider in settings before prompting.";
      return;
    }
    sending = true;
    error = undefined;
    streamingText = "";
    try {
      const agentId = await ensureAgent();
      transcript = [...transcript, { role: "user", text }];
      composerDraft.text = "";
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
  <title>nerve</title>
</svelte:head>

<main class="app-frame">
  <Titlebar
    {activeProject}
    {activeSession}
    {connection}
    {live}
    pendingApprovals={pendingApprovalCount}
    utilityOpen={utilityPanelOpen}
    themePreference={themeState.preference}
    onToggleUtility={() => (utilityPanelOpen = !utilityPanelOpen)}
    onThemeChange={setTheme}
  />

  <div class="workspace-shell" class:utility-open={utilityPanelOpen}>
    <PaneGroup direction="horizontal" autoSaveId="nerve.workspace.v1" keyboardResizeBy={8}>
      <Pane defaultSize={20} minSize={14} maxSize={34} order={1}>
        <div class="pane-shell navigator-pane">
          <ProjectAgentTree
            {projects}
            {sessions}
            {agents}
            selectedProjectId={selection.projectId}
            selectedSessionId={selection.sessionId}
            onOpenSession={openSession}
            onNewConversation={newSession}
          />
        </div>
      </Pane>

      <PaneResizer aria-label="Resize navigator" />

      <Pane defaultSize={utilityPanelOpen ? 56 : 80} minSize={38} order={2}>
        <div class="pane-shell conversation-shell">
          <ConversationPane
            {activeProject}
            {activeSession}
            {activeAgent}
            {transcript}
            {streamingText}
            {live}
            {sending}
            {error}
            composerText={composerDraft.text}
            models={usableModels}
            {selectedModelKey}
            mode={selectedMode}
            permissionLevel={selectedPermissionLevel}
            {slashCompletions}
            fileCompletions={completeFiles}
            onComposerChange={(value) => (composerDraft.text = value)}
            onSubmit={sendPrompt}
            onAbort={abortActiveRun}
            onOpenProject={() => (projectPickerOpen = true)}
            onModelChange={(value) => void setComposerModel(value)}
            onModeChange={(value) => void setComposerMode(value)}
            onPermissionChange={(value) => void setComposerPermission(value)}
          />
        </div>
      </Pane>

      {#if utilityPanelOpen}
        <PaneResizer aria-label="Resize utility panel" />
        <Pane defaultSize={24} minSize={18} maxSize={42} order={3}>
          <div class="pane-shell utility-shell">
            <UtilityPanel
              activeTab={utilityTab}
              {status}
              {activeProject}
              {activeSession}
              {activeAgent}
              {sessionAgents}
              {treeNodes}
              {approvals}
              {processes}
              {selectedProcess}
              {processLogs}
              eventItems={eventBuffer.items}
              bind:settingsDraft
              {authProviders}
              {settingsMessage}
              {exportUrl}
              onTabChange={(tab) => (utilityTab = tab)}
              onSelectAgent={selectAgent}
              onNavigateToEntry={(entryId, summarize) => void navigateToEntry(entryId, summarize)}
              onCompact={() => void compactActiveSession()}
              onGrantApproval={(id) => void grantApproval(id)}
              onDenyApproval={(id) => void denyApproval(id)}
              onSelectProcess={(id) => void selectProcess(id)}
              onRefreshProcessLogs={() => void refreshProcessLogs()}
              onStopProcess={(id) => void stopSelectedProcess(id)}
              onRestartProcess={(id) => void restartSelectedProcess(id)}
              onLoadSettings={() => void loadSettingsPanel()}
              onSaveSettings={() => void saveSettings()}
            />
          </div>
        </Pane>
      {/if}
    </PaneGroup>
  </div>

  <ProjectDirectoryPicker bind:open={projectPickerOpen} onSelect={(path) => void createConversationForDirectory(path)} />
</main>

<style>
  .app-frame {
    display: grid;
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .workspace-shell {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-bg-deep);
  }

  .workspace-shell :global([data-pane-group]) {
    width: 100%;
    height: 100%;
  }

  .pane-shell {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-pane);
  }

  .conversation-shell {
    background: var(--color-bg);
  }

  .utility-shell {
    background: var(--color-panel-muted);
  }

  @media (max-width: 980px) {
    .workspace-shell {
      overflow: auto;
    }

    .workspace-shell :global([data-pane-group]) {
      min-width: 980px;
    }
  }
</style>
