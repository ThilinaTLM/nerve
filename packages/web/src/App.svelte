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
  import CenterTabStrip from "./lib/components/app/CenterTabStrip.svelte";
  import FilePane from "./lib/components/app/FilePane.svelte";
  import Footerbar from "./lib/components/app/Footerbar.svelte";
  import ProcessOutputPane from "./lib/components/app/ProcessOutputPane.svelte";
  import ProjectAgentTree from "./lib/components/app/ProjectAgentTree.svelte";
  import ProjectDirectoryPicker from "./lib/components/app/ProjectDirectoryPicker.svelte";
  import SettingsPage from "./lib/components/app/SettingsPage.svelte";
  import Titlebar from "./lib/components/app/Titlebar.svelte";
  import UtilityPanel from "./lib/components/app/UtilityPanel.svelte";
  import {
    abortActiveRun,
    acceptPendingPlanReview,
    answerUserQuestionById,
    closeCenterTab,
    compactActiveSession,
    completeFiles,
    createConversationForDirectory,
    deleteProjectAndRefresh,
    deleteSessionAndRefresh,
    denyApproval,
    discardPendingPlanReview,
    dismissUserQuestionById,
    disconnectWorkbench,
    exportUrl,
    grantApproval,
    initializeWorkbench,
    loadSettingsPanel,
    navigateToEntry,
    newConversationInProject,
    newSession,
    openFilePane,
    openProcessTab,
    openSettingsPane,
    openSession,
    pruneStoppedProcesses,
    refreshFilePane,
    refreshProcessLogs,
    requestPendingPlanChanges,
    removeProcess,
    restartSelectedProcess,
    saveSettings,
    selectCenterTab,
    sendPrompt,
    setActiveComposerText,
    setComposerMode,
    setComposerModel,
    setComposerPermission,
    setComposerThinkingLevel,
    setTheme,
    stopSelectedProcess,
    systemPromptUrl,
    workbenchSelectors,
    workbenchState,
  } from "./lib/stores/workbench.svelte";


  const status = $derived(workbenchSelectors.status);
  const connection = $derived(workbenchSelectors.connection);
  const error = $derived(workbenchSelectors.error);
  const sending = $derived(workbenchSelectors.sending);
  const projects = $derived(workbenchSelectors.projects);
  const sessions = $derived(workbenchSelectors.sessions);
  const agents = $derived(workbenchSelectors.agents);
  const approvals = $derived(workbenchSelectors.approvals);
  const pendingUserQuestion = $derived(workbenchSelectors.activeUserQuestion);
  const pendingPlanReview = $derived(workbenchSelectors.activePlanReview);
  const processes = $derived(workbenchSelectors.scopedProcesses);
  const treeNodes = $derived(workbenchSelectors.treeNodes);
  const processLogs = $derived(workbenchSelectors.processLogs);
  const transcript = $derived(workbenchSelectors.transcript);
  const toolCalls = $derived(workbenchSelectors.toolCalls);
  const streamingText = $derived(workbenchSelectors.streamingText);
  const conversationLiveState = $derived(workbenchSelectors.conversationLiveState);
  const activeComposerText = $derived(workbenchSelectors.activeComposerText);
  const centerTabs = $derived(workbenchSelectors.centerTabs);
  const activeCenterTab = $derived(workbenchSelectors.activeCenterTab);
  const activeCenterFileView = $derived(workbenchSelectors.activeCenterFileView);
  const slashCompletions = $derived(workbenchSelectors.slashCompletions);
  const selectedModelKey = $derived(workbenchSelectors.selectedModelKey);
  const selectedThinkingLevel = $derived(workbenchSelectors.selectedThinkingLevel);
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
  const activeCenterProcess = $derived(workbenchSelectors.activeCenterProcess);
  const sessionAgents = $derived(workbenchSelectors.sessionAgents);
  const usableModels = $derived(workbenchSelectors.usableModels);

  function selectAgent(agent: AgentRecord) {
    selection.agentId = agent.id;
    selection.projectId = agent.projectId;
    selection.sessionId = agent.sessionId;
    layout.utilityTab = "info";
  }

  function openProjectPicker() {
    workbenchState.projectPickerOpen = true;
  }

  function openToolFile(path: string, line?: number) {
    if (!activeProject) return;
    void openFilePane({ projectId: activeProject.id, path, line });
  }

  onMount(() => {
    const startedOnSettings =
      window.location.pathname === "/settings" ||
      window.location.pathname === "/settings/";
    if (startedOnSettings) {
      window.history.replaceState({}, "", `/${window.location.search}${window.location.hash}`);
    }
    setSidebarCollapsed(loadSidebarCollapsed());
    setUtilityCollapsed(loadUtilityCollapsed());

    void initializeWorkbench().then(() => {
      if (startedOnSettings) void openSettingsPane();
    });

    return () => {
      disconnectWorkbench();
    };
  });
</script>

<svelte:head>
  <title>nerve</title>
</svelte:head>

<main class="app-frame">
  <Titlebar
    {activeProject}
    settingsActive={activeCenterTab?.kind === "settings"}
    onOpenProject={openProjectPicker}
    onOpenSettings={() => void openSettingsPane()}
  />

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
                onNewConversationInProject={newConversationInProject}
                onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
                onDeleteSession={(id) => void deleteSessionAndRefresh(id)}
              />
            </div>
          </Pane>
          <PaneResizer aria-label="Resize agents panel" />
        {/if}

        <Pane defaultSize={57} minSize={38} order={2}>
          <div class="pane-shell center-shell">
            <CenterTabStrip
              tabs={centerTabs}
              homeDir={status?.storage.home}
              onSelect={(tab) => void selectCenterTab(tab)}
              onClose={(tab) => void closeCenterTab(tab)}
              onNewConversation={newSession}
            />
            {#if activeCenterTab?.kind === "process"}
              <ProcessOutputPane
                process={activeCenterProcess}
                {processLogs}
                homeDir={status?.storage.home}
                onRefresh={() => void refreshProcessLogs()}
                onRestart={(id) => void restartSelectedProcess(id)}
                onStop={(id) => void stopSelectedProcess(id)}
              />
            {:else if activeCenterTab?.kind === "file"}
              <FilePane
                view={activeCenterFileView}
                homeDir={status?.storage.home}
                onRefresh={(id) => void refreshFilePane(id)}
              />
            {:else if activeCenterTab?.kind === "settings"}
              <SettingsPage
                {status}
                bind:settingsDraft={workbenchState.settingsDraft}
                {authProviders}
                {settingsMessage}
                themePreference={themeState.preference}
                onLoadSettings={() => void loadSettingsPanel()}
                onSaveSettings={() => void saveSettings()}
                onThemeChange={setTheme}
              />
            {:else}
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
                {pendingPlanReview}
                {transcript}
                {toolCalls}
                {streamingText}
                liveState={conversationLiveState}
                {live}
                {sending}
                {error}
                composerText={activeComposerText}
                models={usableModels}
                {selectedModelKey}
                thinkingLevel={selectedThinkingLevel}
                mode={selectedMode}
                permissionLevel={selectedPermissionLevel}
                {slashCompletions}
                fileCompletions={completeFiles}
                onComposerChange={setActiveComposerText}
                onSubmit={sendPrompt}
                onAnswerUserQuestion={answerUserQuestionById}
                onDismissUserQuestion={dismissUserQuestionById}
                onAbort={abortActiveRun}
                onOpenProject={openProjectPicker}
                onNewConversationInProject={newConversationInProject}
                onOpenFile={openToolFile}
                onModelChange={(value) => void setComposerModel(value)}
                onThinkingLevelChange={(value) => void setComposerThinkingLevel(value)}
                onModeChange={(value) => void setComposerMode(value)}
                onPermissionChange={(value) => void setComposerPermission(value)}
                onGrantApproval={(id) => void grantApproval(id)}
                onDenyApproval={(id) => void denyApproval(id)}
                onAcceptPlanReview={(id) => void acceptPendingPlanReview(id)}
                onRequestPlanChanges={(id, feedback) => void requestPendingPlanChanges(id, feedback)}
                onDiscardPlanReview={(id) => void discardPendingPlanReview(id)}
              />
            {/if}
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
                homeDir={status?.storage.home}
                {exportUrl}
                {systemPromptUrl}
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
                onOpenProcessOutput={(id) => {
                  layout.utilityTab = "processes";
                  void openProcessTab(id);
                }}
                onStopProcess={(id) => void stopSelectedProcess(id)}
                onRestartProcess={(id) => void restartSelectedProcess(id)}
                onRemoveProcess={(id) => void removeProcess(id)}
                onPruneProcesses={() => void pruneStoppedProcesses()}
              />
            </div>
          </Pane>
        {/if}
      </PaneGroup>
  </div>

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

  .workspace-shell {
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

  .center-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--background);
  }

  .utility-shell {
    background: var(--sidebar);
  }

  @media (max-width: 980px) {
    /* Desktop/workbench-first shell: preserve pane usability instead of collapsing to mobile drawers. */
    .workspace-shell {
      overflow: auto;
    }

    .workspace-shell :global([data-pane-group]) {
      min-width: 980px;
    }
  }
</style>
