<script lang="ts">
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

  import { onMount, type Snippet } from "svelte";
  import {
    desktopRuntime,
    initializeDesktopRuntime,
    syncDesktopCloseToTray,
  } from "$lib/features/desktop/state/desktop-bridge.svelte";
  import { initializeNotifications } from "$lib/features/notifications/notify.svelte";
  import { registerFeatureEventHandlers } from "$lib/features/register-feature-events";
  import {
    layout,
    loadSidebarCollapsed,
    loadUtilityCollapsed,
    setSidebarCollapsed,
    setUtilityCollapsed,
    zoomState,
  } from "$lib/app/layout/layout-state.svelte";
  import {
    escapeComposer,
    focusProjectSearch,
    toggleComposerMic,
  } from "$lib/app/state/workbench-ui-state.svelte";
  import { createAppShortcuts } from "$lib/core/shortcuts/app-shortcuts.svelte";
  import { abortActiveRun } from "$lib/features/conversations/state/conversation-flow/run-control";
  import { refreshConversationView } from "$lib/features/conversations/state/conversation-flow/selection";
  import {
    setComposerMode,
    setComposerPermission,
    setComposerThinkingLevel,
  } from "$lib/features/conversations/state/composer-config.svelte";
  import { conversationSelectors } from "$lib/features/conversations/state/conversation-selectors.svelte";
  import { refreshFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
  import {
    clearGitContext,
    refreshGitContext,
    startGitContextAutoRefresh,
  } from "$lib/features/git/state/git-context.svelte";
  import { refreshPrPane } from "$lib/features/git/state/pr-tabs.svelte";
  import {
    loadSettingsPanel,
    openSettingsPane,
    setUiZoomLevel,
  } from "$lib/features/settings/state/settings-actions.svelte";
  import { settingsSelectors } from "$lib/features/settings/state/settings-selectors.svelte";
  import { disconnectWorkbench, initializeWorkbench } from "$lib/core/events/websocket-client.svelte";
  import {
    centerTabsExcept,
    closeCenterTabs,
  } from "$lib/features/workspace/state/center-tab-actions.svelte";
  import {
    closeCenterTab,
    selectCenterTab,
  } from "$lib/features/workspace/state/center-tabs.svelte";
  import { newConversation } from "$lib/features/workspace/state/workspace-actions.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import type { CenterTabIdentity } from "$lib/features/workspace";

  type Props = {
    children?: Snippet;
  };

  let { children }: Props = $props();

  const activeProject = $derived(workspaceSelectors.activeProject);
  const activeConversation = $derived(conversationSelectors.activeConversation);
  const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
  const centerTabs = $derived(workspaceSelectors.centerTabs);
  const live = $derived(conversationSelectors.live);
  const pendingConversationActive = $derived(
    conversationSelectors.pendingConversationActive,
  );
  const selectedMode = $derived(conversationSelectors.selectedMode);
  const selectedModelKey = $derived(conversationSelectors.selectedModelKey);
  const selectedPermissionLevel = $derived(
    conversationSelectors.selectedPermissionLevel,
  );
  const selectedThinkingLevel = $derived(
    conversationSelectors.selectedThinkingLevel,
  );
  const sending = $derived(conversationSelectors.sending);
  const settingsDraft = $derived(settingsSelectors.settingsDraft);
  const usableModels = $derived(conversationSelectors.usableModels);
  const currentZoomLevel = $derived(
    settingsDraft?.ui.zoomLevel ?? zoomState.level,
  );

  function openProjectPicker() {
    workspaceState.projectPickerOpen = true;
  }

  function focusProjectSearchShortcut() {
    if (layout.sidebarCollapsed) setSidebarCollapsed(false);
    focusProjectSearch();
  }

  function refreshCenterTab(tab: CenterTabIdentity) {
    if (tab.kind === "conversation") void refreshConversationView(tab.id);
    else if (tab.kind === "pending-conversation") void selectCenterTab(tab);
    else if (tab.kind === "process") void selectCenterTab(tab);
    else if (tab.kind === "file") void refreshFilePane(tab.id);
    else if (tab.kind === "pr") void refreshPrPane(tab.id);
    else void loadSettingsPanel();
  }

  const appShortcuts = createAppShortcuts({
    currentZoomLevel: () => currentZoomLevel,
    setUiZoomLevel,
    centerTabs: () => centerTabs,
    activeCenterTab: () => activeCenterTab,
    selectCenterTab,
    newConversation,
    openProjectPicker,
    closeCenterTab,
    closeCenterTabs,
    centerTabsExcept,
    refreshCenterTab,
    focusProjectSearch: focusProjectSearchShortcut,
    hasConversationComposer: () =>
      Boolean(activeConversation || pendingConversationActive),
    sending: () => sending,
    live: () => live,
    abortActiveRun,
    composerEscape: escapeComposer,
    toggleMic: toggleComposerMic,
    selectedPermissionLevel: () => selectedPermissionLevel,
    setComposerPermission,
    usableModels: () => usableModels,
    selectedModelKey: () => selectedModelKey,
    selectedThinkingLevel: () => selectedThinkingLevel,
    setComposerThinkingLevel,
    selectedMode: () => selectedMode,
    setComposerMode,
  });

  let lastSyncedCloseToTray: boolean | undefined;
  $effect(() => {
    const value = settingsDraft?.desktop.closeToTray;
    if (
      !desktopRuntime.isDesktop ||
      value === undefined ||
      value === lastSyncedCloseToTray
    ) {
      return;
    }
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
    const unregisterFeatureEvents = registerFeatureEventHandlers();
    const unsubscribeDesktop = initializeDesktopRuntime();
    const stopGitContextAutoRefresh = startGitContextAutoRefresh();
    initializeNotifications();
    const startedOnSettings =
      window.location.pathname === "/settings" ||
      window.location.pathname === "/settings/";
    if (startedOnSettings) {
      window.history.replaceState(
        {},
        "",
        `/${window.location.search}${window.location.hash}`,
      );
    }
    setSidebarCollapsed(loadSidebarCollapsed());
    setUtilityCollapsed(loadUtilityCollapsed());
    window.addEventListener("keydown", appShortcuts.handleWorkbenchShortcut, {
      capture: true,
    });

    void initializeWorkbench().then(() => {
      if (startedOnSettings) void openSettingsPane();
    });

    return () => {
      window.removeEventListener(
        "keydown",
        appShortcuts.handleWorkbenchShortcut,
        { capture: true },
      );
      unsubscribeDesktop();
      stopGitContextAutoRefresh();
      unregisterFeatureEvents();
      disconnectWorkbench();
    };
  });
</script>

{@render children?.()}
