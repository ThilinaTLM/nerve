<script lang="ts">
import { onMount, type Snippet } from "svelte";
import {
  desktopRuntime,
  initializeDesktopRuntime,
  syncDesktopCloseToTray,
} from "$lib/features/desktop";
import {
  configureNotificationPreferences,
  initializeNotificationAudio,
  initializeNotifications,
} from "$lib/features/notifications/notify.svelte";
import { registerFeatureEventHandlers } from "$lib/features/register-feature-events";
import { zoomState } from "$lib/app/shell/appearance.svelte";
import { revealPanelView } from "$lib/app/shell/shell-layout.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  abortActiveRun,
  cancelActiveCompaction,
  conversationSelectors,
  escapeComposer,
  setComposerMode,
  setComposerPermission,
  setComposerThinkingLevel,
  toggleComposerMic,
} from "$lib/features/conversations";
import { focusProjectSearch } from "$lib/features/projects";
import { createAppShortcuts } from "$lib/core/shortcuts/app-shortcuts.svelte";
import {
  clearGitContext,
  refreshGitContext,
  startGitRefreshCoordinator,
  createGitStartupPolicy,
} from "$lib/features/git";
import {
  openSettingsPane,
  settingsSelectors,
  setUiZoomLevel,
} from "$lib/features/settings";
import {
  disconnectWorkbench,
  initializeWorkbench,
} from "$lib/core/events/websocket-client.svelte";
import { workbenchStartupState } from "$lib/core/startup/workbench-startup-state.svelte";
import { shouldRevealWorkbench } from "$lib/core/startup/workbench-startup-machine";
import StartupSplash from "$lib/app/shell/StartupSplash.svelte";
import {
  centerTabsExcept,
  closeCenterTab,
  closeCenterTabs,
  newConversation,
  selectCenterTab,
  workspaceSelectors,
  workspaceState,
} from "$lib/features/workspace";
import { refreshCenterTab } from "$lib/app/shell/refresh-center-tab.svelte";

type Props = {
  children?: Snippet;
};

let { children }: Props = $props();

const activeProject = $derived(workspaceSelectors.activeProject);
const activeConversation = $derived(conversationSelectors.activeConversation);
const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
const centerTabs = $derived(workspaceSelectors.centerTabs);
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
const compacting = $derived(conversationSelectors.compacting);
const settingsDraft = $derived(settingsSelectors.settingsDraft);
const usableModels = $derived(conversationSelectors.usableModels);
const currentZoomLevel = $derived(
  settingsDraft?.ui.zoomLevel ?? zoomState.level,
);
const revealWorkbench = $derived(
  shouldRevealWorkbench(workbenchStartupState.phase),
);

function openProjectPicker() {
  workspaceState.projectPickerOpen = true;
}

function focusProjectSearchShortcut() {
  revealPanelView("conversations", responsive.isCompact);
  focusProjectSearch();
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
  sending: () => sending || compacting,
  abortActiveRun: () =>
    compacting ? cancelActiveCompaction() : abortActiveRun(),
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

$effect(() => {
  const preferences = settingsDraft?.notifications;
  if (!preferences) return;
  configureNotificationPreferences(preferences);
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

const gitStartupPolicy = createGitStartupPolicy((projectId) => {
  if (projectId)
    void refreshGitContext(projectId, { reason: "project", force: true });
  else clearGitContext();
});

$effect(() => {
  gitStartupPolicy.update(
    workbenchStartupState.progressiveActive,
    activeProject?.id,
  );
});

$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  return startGitRefreshCoordinator(
    () => void refreshGitContext(undefined, { reason: "focus" }),
  );
});

onMount(() => {
  const unregisterFeatureEvents = registerFeatureEventHandlers();
  const stopNotificationAudio = initializeNotificationAudio();
  const unsubscribeDesktop = initializeDesktopRuntime();
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
  window.addEventListener("keydown", appShortcuts.handleWorkbenchShortcut, {
    capture: true,
  });

  void initializeWorkbench()
    .then((initialized) => {
      if (!initialized) return;
      initializeNotifications();
      if (startedOnSettings) void openSettingsPane();
    })
    .catch(() => undefined);

  return () => {
    window.removeEventListener(
      "keydown",
      appShortcuts.handleWorkbenchShortcut,
      { capture: true },
    );
    unsubscribeDesktop();
    stopNotificationAudio();
    unregisterFeatureEvents();
    disconnectWorkbench();
  };
});
</script>

{#if revealWorkbench}
  {@render children?.()}
{:else}
  <StartupSplash />
{/if}
