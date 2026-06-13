<script lang="ts">
  import { onMount } from "svelte";
  import {
    Pane,
    PaneGroup,
    Handle as PaneResizer,
  } from "$lib/components/ui/resizable";
  import {
    closeDesktopWindow,
    desktopRuntime,
    initializeDesktopRuntime,
    minimizeDesktopWindow,
    syncDesktopCloseToTray,
    toggleMaximizeDesktopWindow,
  } from "$lib/desktop/bridge.svelte";
  import { checkoutGithubPr, type AgentRecord } from "./lib/api";
  import {
    layout,
    loadSidebarCollapsed,
    loadUtilityCollapsed,
    setSidebarCollapsed,
    setUtilityCollapsed,
    selection,
    zoomState,
  } from "./lib/state/app-state.svelte";
  import ConversationHistoryDialog from "./lib/features/conversations/components/ConversationHistoryDialog.svelte";
  import ConversationPane from "./lib/features/conversations/components/ConversationPane.svelte";
  import CenterTabStrip from "./lib/components/app/CenterTabStrip.svelte";
  import FilePane from "./lib/components/app/FilePane.svelte";
  import Footerbar from "./lib/components/app/Footerbar.svelte";
  import NerveLogsPane from "./lib/features/logs/components/NerveLogsPane.svelte";
  import PrPane from "./lib/features/git/components/PrPane.svelte";
  import ProcessOutputPane from "./lib/features/processes/components/ProcessOutputPane.svelte";
  import ProjectAgentTree from "./lib/features/projects/components/ProjectAgentTree.svelte";
  import BrowserNotificationPrompt from "./lib/notifications/BrowserNotificationPrompt.svelte";
  import ProjectDirectoryPicker from "./lib/features/projects/components/ProjectDirectoryPicker.svelte";
  import SettingsPage from "./lib/features/settings/components/SettingsPage.svelte";
  import Titlebar from "./lib/components/app/Titlebar.svelte";
  import UtilityPanel from "./lib/components/app/UtilityPanel.svelte";
  import {
    abortActiveRun,
    acceptPendingPlanReview,
    answerUserQuestionById,
    centerTabsExcept,
    centerTabsToLeftOf,
    centerTabsToRightOf,
    closeCenterTab,
    closeCenterTabs,
    compactActiveConversation,
    completeFiles,
    continueFromFailure,
    createConversationForDirectory,
    deleteProjectAndRefresh,
    deleteConversationAndRefresh,
    denyApproval,
    dismissUserQuestionById,
    disconnectWorkbench,
    exportUrl,
    grantApproval,
    initializeWorkbench,
    invalidateGit,
    clearGitContext,
    refreshGitContext,
    startGitContextAutoRefresh,
    loadSettingsPanel,
    navigateToEntry,
    newConversationInProject,
    newConversation,
    openFilePane,
    openLogsPane,
    openPrPane,
    openProcessTab,
    openSettingsPane,
    openConversation,
    pruneStoppedProcesses,
    pruneProjectConversationsAndRefresh,
    refreshFilePane,
    refreshPrPane,
    refreshProcessLogs,
    refreshConversationView,
    rejectPendingPlanReview,
    removeProcess,
    restartSelectedProcess,
    runProcessCommand,
    queueSettingsSave,
    selectCenterTab,
    sendPrompt,
    sendPromptText,
    setActiveComposerText,
    setComposerMode,
    setComposerModel,
    setComposerPermission,
    setComposerThinkingLevel,
    setTheme,
    setUiZoomLevel,
    stopSelectedProcess,
    systemPromptUrl,
    toggleFileDisplayMode,
    toggleFileLineWrap,
    workbenchSelectors,
    workbenchState,
    type CenterTabIdentity,
  } from "./lib/stores/workbench.svelte";
  import { initializeNotifications } from "./lib/notifications/notify.svelte";
  import { isEditableTarget, matchesShortcut } from "./lib/shortcuts/keyboard";
  import {
    DEFAULT_SHORTCUTS,
    type ShortcutCommandId,
  } from "./lib/shortcuts/registry";

  const status = $derived(workbenchSelectors.status);
  const connection = $derived(workbenchSelectors.connection);
  const sending = $derived(workbenchSelectors.sending);
  const projects = $derived(workbenchSelectors.projects);
  const conversations = $derived(workbenchSelectors.conversations);
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
  const queuedPrompts = $derived(workbenchSelectors.queuedPrompts);
  const activeComposerText = $derived(workbenchSelectors.activeComposerText);
  const centerTabs = $derived(workbenchSelectors.centerTabs);
  const openConversationTabIds = $derived(workbenchSelectors.openConversationTabIds);
  const activeCenterTab = $derived(workbenchSelectors.activeCenterTab);
  const activeCenterFileView = $derived(workbenchSelectors.activeCenterFileView);
  const activeCenterPrView = $derived(workbenchSelectors.activeCenterPrView);
  const gitSuggestions = $derived(workbenchSelectors.gitSuggestions);
  const slashCompletions = $derived(workbenchSelectors.slashCompletions);
  const selectedModelKey = $derived(workbenchSelectors.selectedModelKey);
  const selectedThinkingLevel = $derived(workbenchSelectors.selectedThinkingLevel);
  const selectedMode = $derived(workbenchSelectors.selectedMode);
  const selectedPermissionLevel = $derived(
    workbenchSelectors.selectedPermissionLevel,
  );
  const settingsDraft = $derived(workbenchSelectors.settingsDraft);
  const settingsSaveStatus = $derived(workbenchSelectors.settingsSaveStatus);
  const settingsMessage = $derived(workbenchSelectors.settingsMessage);
  const activeProject = $derived(workbenchSelectors.activeProject);
  const activeConversation = $derived(workbenchSelectors.activeConversation);
  const activeAgent = $derived(workbenchSelectors.activeAgent);
  const pendingConversationActive = $derived(workbenchSelectors.pendingConversationActive);
  const live = $derived(workbenchSelectors.live);
  const branchDepth = $derived(workbenchSelectors.branchDepth);
  const gitStatus = $derived(workbenchSelectors.gitStatus);
  const pendingApprovalCount = $derived(workbenchSelectors.pendingApprovalCount);
  const contextUsage = $derived(workbenchSelectors.activeContextUsage);
  const contextWindow = $derived(workbenchSelectors.activeContextWindow);
  const subscriptionUsage = $derived(workbenchSelectors.activeSubscriptionUsage);
  const selectedProcess = $derived(workbenchSelectors.selectedProcess);
  const activeCenterProcess = $derived(workbenchSelectors.activeCenterProcess);
  const conversationAgents = $derived(workbenchSelectors.conversationAgents);
  const usableModels = $derived(workbenchSelectors.usableModels);
  const currentZoomLevel = $derived(settingsDraft?.ui.zoomLevel ?? zoomState.level);
  let desktopQuitRequested = $state(false);
  let projectSearchFocusToken = $state(0);
  let composerFocusToken = $state(0);
  let composerEscapeToken = $state(0);
  let micShortcutToken = $state(0);
  let historyDialogOpen = $state(false);
  const desktopQuitting = $derived(desktopRuntime.quitting || desktopQuitRequested);

  async function jumpToConversationEntry(
    entryId: string | undefined,
    summarize = false,
  ) {
    await navigateToEntry(entryId, summarize);
    composerFocusToken += 1;
  }

  async function editConversationEntry(entry: { parentEntryId?: string; text: string }) {
    await navigateToEntry(entry.parentEntryId);
    setActiveComposerText(entry.text);
    composerFocusToken += 1;
  }

  function selectAgent(agent: AgentRecord) {
    selection.agentId = agent.id;
    selection.projectId = agent.projectId;
    selection.conversationId = agent.conversationId;
    layout.utilityTab = "info";
  }

  function openProjectPicker() {
    workbenchState.projectPickerOpen = true;
  }

  function openToolFile(path: string, line?: number) {
    if (!activeProject) return;
    void openFilePane({ projectId: activeProject.id, path, line });
  }

  function applyGitSuggestion(suggestion: { prompt: string }) {
    const current = activeComposerText.trim();
    setActiveComposerText(
      current ? `${activeComposerText}\n\n${suggestion.prompt}` : suggestion.prompt,
    );
  }

  function sendGitSuggestion(suggestion: { prompt: string }) {
    void sendPromptText(suggestion.prompt, { clearComposer: false });
  }

  async function checkoutActivePr() {
    const view = activeCenterPrView;
    if (!view) return;
    try {
      await checkoutGithubPr(view.projectId, view.repo, view.number);
      invalidateGit(view.projectId);
      void refreshPrPane(view.id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      workbenchState.error = message;
    }
  }

  function handleZoomShortcut(event: KeyboardEvent): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
    if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      setUiZoomLevel(currentZoomLevel + 1);
      return true;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setUiZoomLevel(currentZoomLevel - 1);
      return true;
    }
    if (event.key === "0") {
      event.preventDefault();
      setUiZoomLevel(0);
      return true;
    }
    return false;
  }

  function centerTabIdentity(tab: { kind: CenterTabIdentity["kind"]; id: string }): CenterTabIdentity {
    if (tab.kind === "settings") return { kind: "settings", id: "settings" };
    if (tab.kind === "logs") return { kind: "logs", id: "logs" };
    return { kind: tab.kind, id: tab.id } as CenterTabIdentity;
  }

  function activeCenterTabIndex(): number {
    if (!activeCenterTab) return -1;
    return centerTabs.findIndex(
      (tab) => tab.kind === activeCenterTab.kind && tab.id === activeCenterTab.id,
    );
  }

  function selectRelativeCenterTab(delta: number): boolean {
    if (centerTabs.length === 0) return false;
    const currentIndex = activeCenterTabIndex();
    const startIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (startIndex + delta + centerTabs.length) % centerTabs.length;
    void selectCenterTab(centerTabIdentity(centerTabs[nextIndex]));
    return true;
  }

  function selectCenterTabByIndex(index: number): boolean {
    const tab = centerTabs[index];
    if (!tab) return false;
    void selectCenterTab(centerTabIdentity(tab));
    return true;
  }

  function hasConversationComposer(): boolean {
    return Boolean(activeConversation || pendingConversationActive);
  }

  function cyclePermissionLevel(): boolean {
    if (!hasConversationComposer()) return false;
    const order: NonNullable<typeof selectedPermissionLevel>[] = [
      "read_only",
      "supervised",
      "autonomous",
    ];
    const currentIndex = order.indexOf(selectedPermissionLevel);
    const next = order[(currentIndex + 1) % order.length] ?? order[0];
    void setComposerPermission(next);
    return true;
  }

  function cycleThinkingLevel(): boolean {
    if (!hasConversationComposer()) return false;
    const selectedModel = usableModels.find((model) => {
      const key = `${model.provider}:${model.modelId}`;
      return key === selectedModelKey;
    });
    const levels = selectedModel?.supportedThinkingLevels?.length
      ? selectedModel.supportedThinkingLevels
      : ["off" as const];
    const currentIndex = levels.indexOf(selectedThinkingLevel);
    const next = levels[(currentIndex + 1) % levels.length] ?? levels[0] ?? "off";
    void setComposerThinkingLevel(next);
    return true;
  }

  function toggleComposerModeShortcut(): boolean {
    if (!hasConversationComposer()) return false;
    void setComposerMode(selectedMode === "coding" ? "planning" : "coding");
    return true;
  }

  function focusProjectSearchShortcut(): boolean {
    if (layout.sidebarCollapsed) setSidebarCollapsed(false);
    projectSearchFocusToken += 1;
    return true;
  }

  function runShortcutCommand(id: ShortcutCommandId): boolean {
    if (id.startsWith("pane.focusByIndex.")) {
      const index = Number(id.split(".").at(-1)) - 1;
      return Number.isInteger(index) && selectCenterTabByIndex(index);
    }

    switch (id) {
      case "conversation.new":
        newConversation();
        return true;
      case "conversation.newFromProject":
        openProjectPicker();
        return true;
      case "pane.close":
        if (!activeCenterTab) return false;
        void closeCenterTab(activeCenterTab);
        return true;
      case "pane.closeOthers":
        if (!activeCenterTab) return false;
        void closeCenterTabs(centerTabsExcept(activeCenterTab), activeCenterTab);
        return true;
      case "pane.refresh":
        if (!activeCenterTab) return false;
        refreshCenterTab(activeCenterTab);
        return true;
      case "pane.previous":
        return selectRelativeCenterTab(-1);
      case "pane.next":
        return selectRelativeCenterTab(1);
      case "projectSearch.focus":
        return focusProjectSearchShortcut();
      case "composer.focus":
      case "composer.cancelMic":
        if (!hasConversationComposer()) return false;
        composerEscapeToken += 1;
        return true;
      case "composer.stopRun":
        if (!sending && !live) return false;
        void abortActiveRun();
        return true;
      case "composer.toggleMic":
        if (!hasConversationComposer()) return false;
        micShortcutToken += 1;
        return true;
      case "composer.toggleMode":
        return toggleComposerModeShortcut();
      case "composer.cyclePermission":
        return cyclePermissionLevel();
      case "composer.cycleThinking":
        return cycleThinkingLevel();
      case "zoom.in":
      case "zoom.out":
      case "zoom.reset":
      case "composer.send":
        return false;
    }
    return false;
  }

  function handleWorkbenchShortcut(event: KeyboardEvent) {
    if (handleZoomShortcut(event)) return;

    const command = DEFAULT_SHORTCUTS.find((candidate) =>
      matchesShortcut(event, candidate.defaultBinding),
    );
    if (!command) return;
    if (isEditableTarget(event.target) && !command.allowInEditable) return;

    const handled = runShortcutCommand(command.id);
    if (!handled) return;
    if (command.id !== "composer.focus" && command.id !== "composer.cancelMic") {
      event.preventDefault();
    }
  }

  function refreshCenterTab(tab: CenterTabIdentity) {
    if (tab.kind === "conversation") void refreshConversationView(tab.id);
    else if (tab.kind === "pending-conversation") void selectCenterTab(tab);
    else if (tab.kind === "process") void selectCenterTab(tab);
    else if (tab.kind === "file") void refreshFilePane(tab.id);
    else if (tab.kind === "pr") void refreshPrPane(tab.id);
    else void loadSettingsPanel();
  }

  function closeOtherCenterTabs(tab: CenterTabIdentity) {
    void closeCenterTabs(centerTabsExcept(tab), tab);
  }

  function closeCenterTabsRight(tab: CenterTabIdentity) {
    void closeCenterTabs(centerTabsToRightOf(tab), tab);
  }

  function closeCenterTabsLeft(tab: CenterTabIdentity) {
    void closeCenterTabs(centerTabsToLeftOf(tab), tab);
  }

  async function handleDesktopClose() {
    const closeToTray = settingsDraft?.desktop.closeToTray ?? true;
    if (!closeToTray) {
      desktopQuitRequested = true;
      desktopRuntime.quitting = true;
    }
    try {
      await closeDesktopWindow({ closeToTray });
    } catch (caught) {
      if (!closeToTray) {
        desktopQuitRequested = false;
        desktopRuntime.quitting = false;
      }
      workbenchState.error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  let lastSyncedCloseToTray: boolean | undefined;
  $effect(() => {
    const value = settingsDraft?.desktop.closeToTray;
    if (!desktopRuntime.isDesktop || value === undefined || value === lastSyncedCloseToTray) return;
    lastSyncedCloseToTray = value;
    void syncDesktopCloseToTray(value);
  });

  let lastGitProjectId: string | undefined;
  $effect(() => {
    const projectId = activeProject?.id;
    if (projectId === lastGitProjectId) return;
    lastGitProjectId = projectId;
    if (projectId)
      void refreshGitContext(projectId, { reason: "project", force: true });
    else clearGitContext();
  });

  onMount(() => {
    const unsubscribeDesktop = initializeDesktopRuntime();
    const stopGitContextAutoRefresh = startGitContextAutoRefresh();
    initializeNotifications();
    const startedOnSettings =
      window.location.pathname === "/settings" ||
      window.location.pathname === "/settings/";
    if (startedOnSettings) {
      window.history.replaceState({}, "", `/${window.location.search}${window.location.hash}`);
    }
    setSidebarCollapsed(loadSidebarCollapsed());
    setUtilityCollapsed(loadUtilityCollapsed());
    window.addEventListener("keydown", handleWorkbenchShortcut, { capture: true });

    void initializeWorkbench().then(() => {
      if (startedOnSettings) void openSettingsPane();
    });

    return () => {
      window.removeEventListener("keydown", handleWorkbenchShortcut, { capture: true });
      unsubscribeDesktop();
      stopGitContextAutoRefresh();
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
    desktop={desktopRuntime.isDesktop}
    maximized={desktopRuntime.windowState.maximized}
    closeToTray={settingsDraft?.desktop.closeToTray ?? true}
    quitting={desktopQuitting}
    settingsActive={activeCenterTab?.kind === "settings"}
    logsActive={activeCenterTab?.kind === "logs"}
    onOpenProject={openProjectPicker}
    onOpenLogs={() => openLogsPane()}
    onOpenSettings={() => void openSettingsPane()}
    onMinimize={() => void minimizeDesktopWindow()}
    onToggleMaximize={() => void toggleMaximizeDesktopWindow()}
    onClose={() => void handleDesktopClose()}
  />

  <div class="workspace-shell">
      <PaneGroup direction="horizontal" autoSaveId="nerve.workspace.v3" keyboardResizeBy={8}>
        {#if !layout.sidebarCollapsed}
          <Pane defaultSize={19} minSize={14} maxSize={32} order={1}>
            <div class="pane-shell navigator-pane">
              <ProjectAgentTree
                {projects}
                {conversations}
                {agents}
                homeDir={status?.storage.home}
                selectedProjectId={selection.projectId}
                selectedConversationId={selection.conversationId}
                {openConversationTabIds}
                searchFocusToken={projectSearchFocusToken}
                onOpenConversation={openConversation}
                onNewConversationInProject={newConversationInProject}
                onDeleteProject={(id) => void deleteProjectAndRefresh(id)}
                onDeleteConversation={(id) => void deleteConversationAndRefresh(id)}
                onPruneProjectConversations={(id, request) => void pruneProjectConversationsAndRefresh(id, request)}
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
              onRefresh={refreshCenterTab}
              onCloseOther={closeOtherCenterTabs}
              onCloseRight={closeCenterTabsRight}
              onCloseLeft={closeCenterTabsLeft}
              onToggleFileDisplayMode={toggleFileDisplayMode}
              onToggleFileLineWrap={toggleFileLineWrap}
              onNewConversation={newConversation}
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
              <FilePane view={activeCenterFileView} />
            {:else if activeCenterTab?.kind === "pr"}
              <PrPane
                view={activeCenterPrView}
                onRefresh={() => activeCenterPrView && void refreshPrPane(activeCenterPrView.id)}
                onCheckout={() => void checkoutActivePr()}
                onOpenExternal={() => activeCenterPrView?.detail && window.open(activeCenterPrView.detail.url, "_blank", "noopener")}
              />
            {:else if activeCenterTab?.kind === "settings"}
              <SettingsPage
                {status}
                bind:settingsDraft={workbenchState.settingsDraft}
                models={workbenchState.models}
                authProviders={workbenchState.authProviders}
                {settingsSaveStatus}
                {settingsMessage}
                onSettingsChange={queueSettingsSave}
                onThemeChange={setTheme}
              />
            {:else if activeCenterTab?.kind === "logs"}
              <NerveLogsPane />
            {:else}
              <ConversationPane
                {activeProject}
                {activeConversation}
                {activeAgent}
                {pendingConversationActive}
                {projects}
                {conversations}
                {agents}
                homeDir={status?.storage.home}
                {approvals}
                {pendingUserQuestion}
                {pendingPlanReview}
                {transcript}
                {toolCalls}
                {treeNodes}
                {streamingText}
                liveState={conversationLiveState}
                {queuedPrompts}
                {live}
                {sending}
                composerText={activeComposerText}
                {gitSuggestions}
                onSendGitSuggestion={sendGitSuggestion}
                onDraftGitSuggestion={applyGitSuggestion}
                models={usableModels}
                {selectedModelKey}
                thinkingLevel={selectedThinkingLevel}
                mode={selectedMode}
                permissionLevel={selectedPermissionLevel}
                {slashCompletions}
                {contextUsage}
                {contextWindow}
                {composerFocusToken}
                {composerEscapeToken}
                {micShortcutToken}
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
                onRejectPlanReview={(id) => void rejectPendingPlanReview(id)}
                onContinueFromFailure={(id) => void continueFromFailure(id)}
                onNavigateToEntry={(entryId, summarize) => {
                  void jumpToConversationEntry(entryId, summarize);
                }}
                onEditEntry={(entry) => {
                  void editConversationEntry(entry);
                }}
                onOpenHistory={() => (historyDialogOpen = true)}
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
                {activeConversation}
                {activeAgent}
                {conversationAgents}
                {processes}
                {selectedProcess}
                homeDir={status?.storage.home}
                {exportUrl}
                {systemPromptUrl}
                onTabChange={(tab) => (layout.utilityTab = tab)}
                onSelectAgent={selectAgent}
                onOpenProcessOutput={(id) => {
                  layout.utilityTab = "processes";
                  void openProcessTab(id);
                }}
                onStopProcess={(id) => void stopSelectedProcess(id)}
                onRestartProcess={(id) => void restartSelectedProcess(id)}
                onRemoveProcess={(id) => void removeProcess(id)}
                onPruneProcesses={() => void pruneStoppedProcesses()}
                onRunCommand={(input) => {
                  layout.utilityTab = "processes";
                  void (async () => {
                    const process = await runProcessCommand(input);
                    await openProcessTab(process.id);
                  })();
                }}
              />
            </div>
          </Pane>
        {/if}
      </PaneGroup>
  </div>

  <Footerbar
    {activeProject}
    {activeConversation}
    {activeAgent}
    {connection}
    {live}
    pendingApprovals={pendingApprovalCount}
    {processes}
    {branchDepth}
    {gitStatus}
    {subscriptionUsage}
    homeDir={status?.storage.home}
    zoomLevel={currentZoomLevel}
    sidebarCollapsed={layout.sidebarCollapsed}
    utilityCollapsed={layout.utilityCollapsed}
    onZoomLevelChange={setUiZoomLevel}
    onToggleSidebar={() => setSidebarCollapsed(!layout.sidebarCollapsed)}
    onToggleUtility={() => setUtilityCollapsed(!layout.utilityCollapsed)}
  />
  <BrowserNotificationPrompt />

  {#if desktopRuntime.isDesktop && desktopQuitting}
    <div class="shutdown-overlay" role="status" aria-live="polite">
      <div class="shutdown-card">
        <div class="shutdown-spinner" aria-hidden="true"></div>
        <strong>Closing Nerve…</strong>
        <span>Stopping the local daemon safely.</span>
      </div>
    </div>
  {/if}
</main>

<ProjectDirectoryPicker
  bind:open={workbenchState.projectPickerOpen}
  {projects}
  {conversations}
  homeDir={status?.storage.home}
  onSelect={(path) => void createConversationForDirectory(path)}
  onForget={(id) => void deleteProjectAndRefresh(id)}
/>

<ConversationHistoryDialog
  bind:open={historyDialogOpen}
  {activeConversation}
  {treeNodes}
  {toolCalls}
  onNavigateToEntry={(entryId, summarize) => {
    void jumpToConversationEntry(entryId, summarize);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
  onCompact={() => void compactActiveConversation()}
/>

<style>
  .app-frame {
    display: grid;
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    grid-template-rows: 3rem minmax(0, 1fr) 1.75rem;
    position: relative;
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

  .shutdown-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: color-mix(in oklab, var(--background) 72%, transparent);
    backdrop-filter: blur(10px);
  }

  .shutdown-card {
    display: grid;
    justify-items: center;
    gap: 0.45rem;
    min-width: 16rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    padding: 1.25rem 1.5rem;
    color: var(--foreground);
    box-shadow: var(--shadow-md);
  }

  .shutdown-card span {
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .shutdown-spinner {
    width: 1.75rem;
    height: 1.75rem;
    border: 2px solid var(--muted);
    border-top-color: var(--primary);
    border-radius: 999px;
    animation: shutdown-spin 800ms linear infinite;
  }

  @keyframes shutdown-spin {
    to {
      transform: rotate(360deg);
    }
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
