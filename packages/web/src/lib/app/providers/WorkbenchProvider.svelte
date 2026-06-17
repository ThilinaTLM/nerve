<script lang="ts">
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
  import { createAppShortcuts } from "$lib/shortcuts/app-shortcuts.svelte";
  import {
    abortActiveRun,
    centerTabsExcept,
    closeCenterTab,
    closeCenterTabs,
    clearGitContext,
    disconnectWorkbench,
    initializeWorkbench,
    loadSettingsPanel,
    newConversation,
    openSettingsPane,
    refreshConversationView,
    refreshFilePane,
    refreshGitContext,
    refreshPrPane,
    selectCenterTab,
    setComposerMode,
    setComposerPermission,
    setComposerThinkingLevel,
    setUiZoomLevel,
    startGitContextAutoRefresh,
    workbenchSelectors,
    workbenchState,
    type CenterTabIdentity,
  } from "$lib/stores/workbench.svelte";

  type Props = {
    children?: Snippet;
  };

  let { children }: Props = $props();

  const activeProject = $derived(workbenchSelectors.activeProject);
  const activeConversation = $derived(workbenchSelectors.activeConversation);
  const activeCenterTab = $derived(workbenchSelectors.activeCenterTab);
  const centerTabs = $derived(workbenchSelectors.centerTabs);
  const live = $derived(workbenchSelectors.live);
  const pendingConversationActive = $derived(
    workbenchSelectors.pendingConversationActive,
  );
  const selectedMode = $derived(workbenchSelectors.selectedMode);
  const selectedModelKey = $derived(workbenchSelectors.selectedModelKey);
  const selectedPermissionLevel = $derived(
    workbenchSelectors.selectedPermissionLevel,
  );
  const selectedThinkingLevel = $derived(
    workbenchSelectors.selectedThinkingLevel,
  );
  const sending = $derived(workbenchSelectors.sending);
  const settingsDraft = $derived(workbenchSelectors.settingsDraft);
  const usableModels = $derived(workbenchSelectors.usableModels);
  const currentZoomLevel = $derived(
    settingsDraft?.ui.zoomLevel ?? zoomState.level,
  );

  function openProjectPicker() {
    workbenchState.projectPickerOpen = true;
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
