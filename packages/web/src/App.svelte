<script lang="ts">
  import { onMount } from "svelte";
  import {
    Pane,
    PaneGroup,
    Handle as PaneResizer,
  } from "$lib/components/ui/resizable";
  import type { AgentRecord } from "./lib/api";
  import {
    layout,
    loadSidebarCollapsed,
    loadUtilityCollapsed,
    setSidebarCollapsed,
    setUtilityCollapsed,
    selection,
    themeState,
  } from "./lib/state/app-state.svelte";
  import ConversationPane from "./lib/components/app/ConversationPane.svelte";
  import ConversationTabStrip from "./lib/components/app/ConversationTabStrip.svelte";
  import Footerbar from "./lib/components/app/Footerbar.svelte";
  import ProjectAgentTree from "./lib/components/app/ProjectAgentTree.svelte";
  import ProjectDirectoryPicker from "./lib/components/app/ProjectDirectoryPicker.svelte";
  import SettingsPage from "./lib/components/app/SettingsPage.svelte";
  import Titlebar from "./lib/components/app/Titlebar.svelte";
  import UtilityPanel from "./lib/components/app/UtilityPanel.svelte";
  import {
    abortActiveRun,
    answerActiveUserQuestion,
    closeConversationTab,
    compactActiveSession,
    completeFiles,
    createConversationForDirectory,
    deleteProjectAndRefresh,
    deleteSessionAndRefresh,
    denyApproval,
    dismissActiveUserQuestion,
    disconnectWorkbench,
    exportUrl,
    grantApproval,
    initializeWorkbench,
    loadSettingsPanel,
    navigateToEntry,
    newConversationInProject,
    newSession,
    openSession,
    refreshProcessLogs,
    restartSelectedProcess,
    saveSettings,
    selectProcess,
    sendPrompt,
    setActiveComposerText,
    setComposerMode,
    setComposerModel,
    setComposerPermission,
    setSettingsNavigation,
    setTheme,
    stopSelectedProcess,
    workbenchSelectors,
    workbenchState,
  } from "./lib/stores/workbench.svelte";

  type AppRoute = "workspace" | "settings";
  let appRoute = $state<AppRoute>("workspace");

  const status = $derived(workbenchSelectors.status);
  const connection = $derived(workbenchSelectors.connection);
  const error = $derived(workbenchSelectors.error);
  const sending = $derived(workbenchSelectors.sending);
  const projects = $derived(workbenchSelectors.projects);
  const sessions = $derived(workbenchSelectors.sessions);
  const agents = $derived(workbenchSelectors.agents);
  const approvals = $derived(workbenchSelectors.approvals);
  const pendingUserQuestion = $derived(workbenchSelectors.activeUserQuestion);
  const processes = $derived(workbenchSelectors.processes);
  const treeNodes = $derived(workbenchSelectors.treeNodes);
  const processLogs = $derived(workbenchSelectors.processLogs);
  const transcript = $derived(workbenchSelectors.transcript);
  const streamingText = $derived(workbenchSelectors.streamingText);
  const activeComposerText = $derived(workbenchSelectors.activeComposerText);
  const openConversationTabs = $derived(workbenchSelectors.openConversationTabs);
  const slashCompletions = $derived(workbenchSelectors.slashCompletions);
  const selectedModelKey = $derived(workbenchSelectors.selectedModelKey);
  const selectedMode = $derived(workbenchSelectors.selectedMode);
  const selectedPermissionLevel = $derived(
    workbenchSelectors.selectedPermissionLevel,
  );
  const authProviders = $derived(workbenchSelectors.authProviders);
  const settingsMessage = $derived(workbenchSelectors.settingsMessage);
  const activeProject = $derived(workbenchSelectors.activeProject);
  const activeSession = $derived(workbenchSelectors.activeSession);
  const activeAgent = $derived(workbenchSelectors.activeAgent);
  const live = $derived(workbenchSelectors.live);
  const branchDepth = $derived(workbenchSelectors.branchDepth);
  const gitStatus = $derived(workbenchSelectors.gitStatus);
  const pendingApprovalCount = $derived(workbenchSelectors.pendingApprovalCount);
  const selectedProcess = $derived(workbenchSelectors.selectedProcess);
  const sessionAgents = $derived(workbenchSelectors.sessionAgents);
  const usableModels = $derived(workbenchSelectors.usableModels);

  function routeFromPath(pathname: string): AppRoute {
    return pathname === "/settings" || pathname === "/settings/" ? "settings" : "workspace";
  }

  function routePath(route: AppRoute): string {
    return route === "settings" ? "/settings" : "/";
  }

  function navigateToRoute(route: AppRoute, mode: "push" | "replace" = "push") {
    appRoute = route;
    if (typeof window === "undefined") return;
    const nextPath = routePath(route);
    if (window.location.pathname === nextPath) return;
    const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
    if (mode === "replace") window.history.replaceState({ route }, "", nextUrl);
    else window.history.pushState({ route }, "", nextUrl);
  }

  function selectAgent(agent: AgentRecord) {
    selection.agentId = agent.id;
    selection.projectId = agent.projectId;
    selection.sessionId = agent.sessionId;
    layout.utilityTab = "info";
  }

  function openProjectPicker() {
    workbenchState.projectPickerOpen = true;
  }

  onMount(() => {
    const handlePopState = () => (appRoute = routeFromPath(window.location.pathname));

    setSettingsNavigation(() => navigateToRoute("settings"));
    navigateToRoute(routeFromPath(window.location.pathname), "replace");
    setSidebarCollapsed(loadSidebarCollapsed());
    setUtilityCollapsed(loadUtilityCollapsed());
    window.addEventListener("popstate", handlePopState);

    void initializeWorkbench();

    return () => {
      disconnectWorkbench();
      window.removeEventListener("popstate", handlePopState);
    };
  });
</script>

<svelte:head>
  <title>{appRoute === "settings" ? "nerve · settings" : "nerve"}</title>
</svelte:head>

<main class="app-frame">
  <Titlebar
    {activeProject}
    {activeSession}
    {activeAgent}
    {connection}
    {live}
    activeRoute={appRoute}
    pendingApprovals={pendingApprovalCount}
    {processes}
    {branchDepth}
    onOpenSettings={() => navigateToRoute("settings")}
  />

  {#if appRoute === "settings"}
    <div class="settings-shell">
      <SettingsPage
        {status}
        bind:settingsDraft={workbenchState.settingsDraft}
        {authProviders}
        {settingsMessage}
        themePreference={themeState.preference}
        onBack={() => navigateToRoute("workspace")}
        onLoadSettings={() => void loadSettingsPanel()}
        onSaveSettings={() => void saveSettings()}
        onThemeChange={setTheme}
      />
    </div>
  {:else}
    <div class="workspace-shell">
      <PaneGroup direction="horizontal" autoSaveId="nerve.workspace.v3" keyboardResizeBy={8}>
        {#if !layout.sidebarCollapsed}
          <Pane defaultSize={19} minSize={14} maxSize={32} order={1}>
            <div class="pane-shell navigator-pane">
              <ProjectAgentTree
                {projects}
                {sessions}
                {agents}
                homeDir={status?.storage.home}
                selectedProjectId={selection.projectId}
                selectedSessionId={selection.sessionId}
                onOpenSession={openSession}
                onNewConversation={newSession}
                onNewConversationInProject={newConversationInProject}
                onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
                onDeleteSession={(id) => void deleteSessionAndRefresh(id)}
              />
            </div>
          </Pane>
          <PaneResizer aria-label="Resize agents panel" />
        {/if}

        <Pane defaultSize={57} minSize={38} order={2}>
          <div class="pane-shell conversation-shell">
            <ConversationTabStrip
              tabs={openConversationTabs}
              activeSessionId={selection.sessionId}
              homeDir={status?.storage.home}
              onSelect={(id) => void openSession(id)}
              onClose={(id) => void closeConversationTab(id)}
              onNewConversation={newSession}
            />
            <ConversationPane
              {activeProject}
              {activeSession}
              {activeAgent}
              {projects}
              {sessions}
              {agents}
              homeDir={status?.storage.home}
              {approvals}
              {pendingUserQuestion}
              {transcript}
              {streamingText}
              {live}
              {sending}
              {error}
              composerText={activeComposerText}
              models={usableModels}
              {selectedModelKey}
              mode={selectedMode}
              permissionLevel={selectedPermissionLevel}
              {slashCompletions}
              fileCompletions={completeFiles}
              onComposerChange={setActiveComposerText}
              onSubmit={sendPrompt}
              onAnswerUserQuestion={answerActiveUserQuestion}
              onDismissUserQuestion={dismissActiveUserQuestion}
              onAbort={abortActiveRun}
              onOpenProject={openProjectPicker}
              onNewConversationInProject={newConversationInProject}
              onModelChange={(value) => void setComposerModel(value)}
              onModeChange={(value) => void setComposerMode(value)}
              onPermissionChange={(value) => void setComposerPermission(value)}
              onGrantApproval={(id) => void grantApproval(id)}
              onDenyApproval={(id) => void denyApproval(id)}
            />
          </div>
        </Pane>

        {#if !layout.utilityCollapsed}
          <PaneResizer aria-label="Resize utility panel" />

          <Pane defaultSize={24} minSize={19} maxSize={40} order={3}>
            <div class="pane-shell utility-shell">
              <UtilityPanel
                activeTab={layout.utilityTab}
                {status}
                {activeProject}
                {activeSession}
                {activeAgent}
                {sessionAgents}
                {treeNodes}
                {processes}
                {selectedProcess}
                {processLogs}
                {exportUrl}
                onTabChange={(tab) => (layout.utilityTab = tab)}
                onSelectAgent={selectAgent}
                onNavigateToEntry={(entryId, summarize) => {
                  layout.utilityTab = "history";
                  void navigateToEntry(entryId, summarize);
                }}
                onCompact={() => {
                  layout.utilityTab = "history";
                  void compactActiveSession();
                }}
                onSelectProcess={(id) => {
                  layout.utilityTab = "processes";
                  void selectProcess(id);
                }}
                onRefreshProcessLogs={() => void refreshProcessLogs()}
                onStopProcess={(id) => void stopSelectedProcess(id)}
                onRestartProcess={(id) => void restartSelectedProcess(id)}
              />
            </div>
          </Pane>
        {/if}
      </PaneGroup>
    </div>
  {/if}

  <Footerbar
    {activeProject}
    {activeSession}
    {activeAgent}
    {connection}
    {live}
    pendingApprovals={pendingApprovalCount}
    {processes}
    {branchDepth}
    {gitStatus}
    homeDir={status?.storage.home}
    sidebarCollapsed={layout.sidebarCollapsed}
    utilityCollapsed={layout.utilityCollapsed}
    onToggleSidebar={() => setSidebarCollapsed(!layout.sidebarCollapsed)}
    onToggleUtility={() => setUtilityCollapsed(!layout.utilityCollapsed)}
  />
</main>

<ProjectDirectoryPicker
  bind:open={workbenchState.projectPickerOpen}
  {projects}
  {sessions}
  homeDir={status?.storage.home}
  onSelect={(path) => void createConversationForDirectory(path)}
/>

<style>
  .app-frame {
    display: grid;
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    grid-template-rows: 3rem minmax(0, 1fr) 1.75rem;
    overflow: hidden;
    background: var(--background);
    color: var(--foreground);
  }

  .workspace-shell,
  .settings-shell {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--sidebar);
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
    background: var(--sidebar);
  }

  .conversation-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--background);
  }

  .utility-shell {
    background: var(--sidebar);
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
