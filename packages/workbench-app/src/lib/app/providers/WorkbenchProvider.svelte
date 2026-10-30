<script lang="ts">
import { activeComposer } from "$lib/application/composer/active-composer.svelte";
import { onDestroy, onMount, type Snippet } from "svelte";
import {
  desktopRuntime,
  getDesktopBridge,
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
  retainConversationStore,
  type ConversationStore,
  escapeComposer,
  toggleComposerMic,
} from "$lib/features/conversations";
import { selection } from "$lib/application/workspace/selection.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import {
  modelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
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
import {
  retryServerStart,
  rollbackServerUpgrade,
  startReconnectMonitor,
  waitForServerReady,
} from "$lib/application/startup/server-lifecycle.svelte";
import ServerReconnectOverlay from "$lib/app/shell/ServerReconnectOverlay.svelte";
import StartupErrorView from "$lib/app/shell/StartupErrorView.svelte";
import { dismissStartupSplash } from "$lib/app/shell/startup-splash";
import {
  centerTabsExcept,
  hasDirtyFileViews,
  requestCloseCenterTab,
  requestCloseCenterTabs,
  newConversation,
  selectCenterTab,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";
import { refreshCenterTab } from "$lib/app/shell/refresh-center-tab.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { selectablePermissionRuleSets } from "$lib/domain/permissions/rule-set-options";
import {
  agentProfileCatalog,
  leadAgentProfiles,
} from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import {
  projectAgentDefaults,
  observeProjectAgentDefaults,
} from "$lib/application/agent-configuration/project-agent-defaults.svelte";
import { CreationPreferencesState } from "$lib/features/settings/state/creation-preferences.svelte";

type Props = {
  children?: Snippet;
};

let { children }: Props = $props();
const unregisterWorkspaceReadModels = registerWorkspaceReadModels();
onDestroy(unregisterWorkspaceReadModels);

const activeProject = $derived(workspaceSelectors.activeProject);
$effect(() => {
  if (activeProject?.id) void projectAgentDefaults.load(activeProject.id);
});
$effect(() => observeProjectAgentDefaults());
let activeStore = $state<ConversationStore>();
$effect(() => {
  const id = selection.conversationId;
  activeStore = undefined;
  if (!id) return;
  const retained = retainConversationStore(id);
  activeStore = retained.store;
  void retained.ready.catch(() => undefined);
  return retained.release;
});
const creationPreferences = new CreationPreferencesState();
$effect(() => {
  if (activeProject?.id)
    void creationPreferences.load({
      scope: "project",
      projectId: activeProject.id,
    });
});
$effect(() => creationPreferences.observe());
const activeConversation = $derived(activeStore?.snapshot?.conversation);
const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
const centerTabs = $derived(workspaceSelectors.centerTabs);
const hasDirtyFiles = $derived(hasDirtyFileViews());
const agentProfileNames = $derived(
  leadAgentProfiles(agentProfileCatalog.profiles(activeProject?.id)).map(
    (p) => p.name,
  ),
);
const permissionRuleSetIds = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
  ).map((ruleSet) => ruleSet.id),
);
const sending = $derived(activeConversation?.status === "running");
const settingsDraft = $derived(settingsSelectors.settingsDraft);
const usableModels = $derived(
  scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    creationPreferences.result?.status === "available"
      ? creationPreferences.result.effective.scopedModels
      : undefined,
  ),
);
const currentZoomLevel = $derived(
  settingsDraft?.ui.zoomLevel ?? zoomState.level,
);
const revealWorkbench = $derived(
  shouldRevealWorkbench(workbenchStartupState.phase),
);

// index.html owns the splash for the whole boot, so the workbench paints behind
// it and only fades it out here; remounting it would restart the intro.
$effect(() => {
  if (revealWorkbench) dismissStartupSplash();
});

$effect(() => {
  if (!hasDirtyFiles || typeof window === "undefined") return;
  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", warnBeforeUnload);
  return () => window.removeEventListener("beforeunload", warnBeforeUnload);
});

function openProjectPicker() {
  workspaceState.projectPickerMode = "recent";
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
  closeCenterTab: requestCloseCenterTab,
  closeCenterTabs: requestCloseCenterTabs,
  centerTabsExcept,
  refreshCenterTab,
  focusProjectSearch: focusProjectSearchShortcut,
  hasConversationComposer: () => {
    const view = activeComposer();
    return (
      !!view && !(view.target.kind === "conversation" && view.target.readOnly)
    );
  },
  sending: () => sending,
  abortActiveRun: async () => {
    await activeStore?.control("stop");
  },
  composerEscape: escapeComposer,
  toggleMic: toggleComposerMic,
  selectedPermissionRuleSetId: () =>
    activeComposer()?.resolution?.settings.permissionRuleSetId ?? "autonomous",
  permissionRuleSetIds: () => permissionRuleSetIds,
  setComposerPermissionRuleSet: async (id) => {
    await activeComposer()?.setPermission(id);
  },
  usableModels: () => usableModels,
  selectedModelKey: () => {
    const model = activeComposer()?.resolution?.settings.model;
    return model ? modelKey(model) : "";
  },
  setComposerModel: async (key) => {
    await activeComposer()?.setModel(key);
  },
  selectedThinkingLevel: () =>
    activeComposer()?.resolution?.settings.reasoningLevel ?? "off",
  setComposerThinkingLevel: async (level) => {
    await activeComposer()?.setReasoning(level);
  },
  agentProfileNames: () => agentProfileNames,
  selectedAgentProfile: () => activeComposer()?.appliedProfile ?? "",
  setComposerAgentProfile: async (profile) => {
    await activeComposer()?.setProfile(profile);
  },
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

let stopReconnectMonitor: (() => void) | undefined;
let startedOnSettings = false;

async function startWorkbench(): Promise<void> {
  if (!(await waitForServerReady())) return;
  await runWorkbenchStartup();
}

async function runWorkbenchStartup(): Promise<void> {
  try {
    if (!(await initializeWorkbench())) return;
  } catch {
    return;
  }
  void getDesktopBridge()
    ?.app.reportRendererCoreReady()
    .catch(() => undefined);
  initializeNotifications();
  stopReconnectMonitor?.();
  stopReconnectMonitor = startReconnectMonitor();
  if (startedOnSettings) void openSettingsPane();
}

async function retryStartup(discardIds?: string[]): Promise<void> {
  if (await retryServerStart(discardIds)) {
    await runWorkbenchStartup();
  }
}

onMount(() => {
  const unregisterFeatureEvents = registerFeatureEventHandlers();
  const stopNotificationAudio = initializeNotificationAudio();
  const unsubscribeDesktop = initializeDesktopRuntime();
  startedOnSettings =
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

  void startWorkbench();

  return () => {
    stopReconnectMonitor?.();
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
{/if}
<StartupErrorView
  onRetry={() => void retryStartup()}
  onDiscardAndRetry={(ids) => void retryStartup(ids)}
  onRollback={() => void rollbackServerUpgrade()}
/>
<ServerReconnectOverlay />
