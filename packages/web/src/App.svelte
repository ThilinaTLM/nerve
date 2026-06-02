<script lang="ts">
  import { onMount } from "svelte";
  import { Pane, PaneGroup, PaneResizer } from "paneforge";
  import type { AgentRecord } from "./lib/api";
  import {
    applyTheme,
    composerDraft,
    layout,
    loadSidebarCollapsed,
    setSidebarCollapsed,
    selection,
    themeState,
  } from "./lib/state/app-state.svelte";
  import ConversationPane from "./lib/components/app/ConversationPane.svelte";
  import Footerbar from "./lib/components/app/Footerbar.svelte";
  import ProjectAgentTree from "./lib/components/app/ProjectAgentTree.svelte";
  import ProjectDirectoryPicker from "./lib/components/app/ProjectDirectoryPicker.svelte";
  import SettingsPage from "./lib/components/app/SettingsPage.svelte";
  import Titlebar from "./lib/components/app/Titlebar.svelte";
  import UtilityPanel from "./lib/components/app/UtilityPanel.svelte";
  import {
    abortActiveRun,
    activeAgent,
    activeProject,
    activeSession,
    agents,
    approvals,
    authProviders,
    branchDepth,
    compactActiveSession,
    completeFiles,
    connection,
    createConversationForDirectory,
    deleteProjectAndRefresh,
    deleteSessionAndRefresh,
    denyApproval,
    disconnectWorkbench,
    error,
    exportUrl,
    grantApproval,
    initializeWorkbench,
    live,
    loadSettingsPanel,
    navigateToEntry,
    newConversationInProject,
    newSession,
    openSession,
    pendingApprovalCount,
    processLogs,
    processes,
    projects,
    refreshProcessLogs,
    restartSelectedProcess,
    saveSettings,
    selectedModelKey,
    selectedMode,
    selectedPermissionLevel,
    selectedProcess,
    selectProcess,
    sendPrompt,
    sessionAgents,
    sessions,
    setComposerMode,
    setComposerModel,
    setComposerPermission,
    setSettingsNavigation,
    setTheme,
    settingsMessage,
    sending,
    slashCompletions,
    status,
    stopSelectedProcess,
    streamingText,
    transcript,
    treeNodes,
    usableModels,
    workbenchState,
  } from "./lib/stores/workbench.svelte";

  type AppRoute = "workspace" | "settings";
  let appRoute = $state<AppRoute>("workspace");

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
    let themeMedia: MediaQueryList | undefined;
    const handleSystemTheme = () => applyTheme(themeState.preference);
    const handlePopState = () => (appRoute = routeFromPath(window.location.pathname));

    setSettingsNavigation(() => navigateToRoute("settings"));
    navigateToRoute(routeFromPath(window.location.pathname), "replace");
    setSidebarCollapsed(loadSidebarCollapsed());
    window.addEventListener("popstate", handlePopState);

    themeMedia = window.matchMedia("(prefers-color-scheme: light)");
    themeMedia.addEventListener("change", handleSystemTheme);
    void initializeWorkbench();

    return () => {
      disconnectWorkbench();
      themeMedia?.removeEventListener("change", handleSystemTheme);
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
            <ConversationPane
              {activeProject}
              {activeSession}
              {activeAgent}
              {approvals}
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
              onOpenProject={openProjectPicker}
              onModelChange={(value) => void setComposerModel(value)}
              onModeChange={(value) => void setComposerMode(value)}
              onPermissionChange={(value) => void setComposerPermission(value)}
              onGrantApproval={(id) => void grantApproval(id)}
              onDenyApproval={(id) => void denyApproval(id)}
            />
          </div>
        </Pane>

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
    sidebarCollapsed={layout.sidebarCollapsed}
    onToggleSidebar={() => setSidebarCollapsed(!layout.sidebarCollapsed)}
  />
</main>

<ProjectDirectoryPicker
  bind:open={workbenchState.projectPickerOpen}
  {projects}
  onSelect={(path) => void createConversationForDirectory(path)}
/>

<style>
  .app-frame {
    display: grid;
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    grid-template-rows: var(--size-header) minmax(0, 1fr) var(--size-footer);
    overflow: hidden;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .workspace-shell,
  .settings-shell {
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
    background: var(--color-pane);
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
