<script lang="ts">
import { onMount, type Snippet } from "svelte";
import {
  desktopRuntime,
  initializeDesktopRuntime,
  syncDesktopCloseToTray,
} from "$lib/platform/desktop";
import {
  configureNotificationPreferences,
  initializeNotificationAudio,
  initializeNotifications,
} from "$lib/application/notifications/notify.svelte";
import { registerWorkspaceReadModels } from "$lib/app/composition/registrations/register-workspace-read-models.svelte";
import { registerFeatureEventHandlers } from "$lib/app/composition/registrations/register-feature-events";
import { zoomState } from "$lib/platform/appearance/appearance.svelte";
import {
  revealPanelView,
  togglePanelDock,
} from "$lib/app/shell/shell-layout.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  abortActiveRun,
  cancelActiveCompaction,
  conversationSelectors,
  escapeComposer,
  setComposerMode,
  setComposerPermissionRuleSet,
  setComposerThinkingLevel,
  toggleComposerMic,
} from "$lib/features/conversations";
import { focusProjectSearch } from "$lib/features/projects";
import { createAppShortcuts } from "$lib/application/commands/app-shortcuts.svelte";
import {
  clearGitContext,
  refreshGitContext,
  startGitRefreshCoordinator,
  createGitStartupPolicy,
} from "$lib/features/git";
import { settingsSelectors } from "$lib/features/settings";
import { openSettingsPane, setUiZoomLevel } from "$lib/application/settings";
import {
  disconnectWorkbench,
  initializeWorkbench,
} from "$lib/application/startup/workbench-client.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { shouldRevealWorkbench } from "$lib/application/startup/workbench-startup-machine";
import StartupSplash from "$lib/app/shell/StartupSplash.svelte";
import {
  centerTabsExcept,
  closeCenterTab,
  closeCenterTabs,
  newConversation,
  selectCenterTab,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";
import { refreshCenterTab } from "$lib/app/shell/refresh-center-tab.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  effectivePermissionRuleSetId,
  selectablePermissionRuleSets,
} from "$lib/domain/permissions/rule-set-options";

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
const selectedPermissionRuleSetId = $derived(
  effectivePermissionRuleSetId(
    conversationSelectors.selectedPermissionRuleSetId,
    selectedMode,
  ),
);
const permissionRuleSetIds = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
    selectedMode,
  ).map((ruleSet) => ruleSet.id),
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
  selectedPermissionRuleSetId: () => selectedPermissionRuleSetId,
  permissionRuleSetIds: () => permissionRuleSetIds,
  setComposerPermissionRuleSet,
  usableModels: () => usableModels,
  selectedModelKey: () => selectedModelKey,
  selectedThinkingLevel: () => selectedThinkingLevel,
  setComposerThinkingLevel,
  selectedMode: () => selectedMode,
  setComposerMode,
  togglePanelDock: (dock) => togglePanelDock(dock, responsive.isCompact),
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
  registerWorkspaceReadModels();
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
