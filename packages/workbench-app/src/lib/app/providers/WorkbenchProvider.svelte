<script lang="ts">
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
  parseModelKey,
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
import {
  effectivePermissionRuleSetId,
  selectablePermissionRuleSets,
} from "$lib/domain/permissions/rule-set-options";

type Props = {
  children?: Snippet;
};

let { children }: Props = $props();
const unregisterWorkspaceReadModels = registerWorkspaceReadModels();
onDestroy(unregisterWorkspaceReadModels);

const activeProject = $derived(workspaceSelectors.activeProject);
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
const config = $derived(activeStore?.snapshot?.config);
const activeConversation = $derived(activeStore?.snapshot?.conversation);
const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);
const centerTabs = $derived(workspaceSelectors.centerTabs);
const hasDirtyFiles = $derived(hasDirtyFileViews());
const selectedMode = $derived(config?.mode ?? "coding");
const selectedModelKey = $derived(config ? modelKey(config.model) : "");
const selectedPermissionRuleSetId = $derived(
  effectivePermissionRuleSetId(
    config?.permissionRuleSetId ?? "supervised",
    selectedMode,
  ),
);
const permissionRuleSetIds = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
    selectedMode,
  ).map((ruleSet) => ruleSet.id),
);
const selectedThinkingLevel = $derived(config?.reasoningLevel ?? "off");
const sending = $derived(activeConversation?.status === "running");
const settingsDraft = $derived(settingsSelectors.settingsDraft);
const usableModels = $derived(
  scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    settingsDraft?.scopedModels,
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
  hasConversationComposer: () => Boolean(config),
  sending: () => sending,
  abortActiveRun: async () => {
    await activeStore?.control("stop");
  },
  composerEscape: escapeComposer,
  toggleMic: toggleComposerMic,
  selectedPermissionRuleSetId: () => selectedPermissionRuleSetId,
  permissionRuleSetIds: () => permissionRuleSetIds,
  setComposerPermissionRuleSet: async (permissionRuleSetId) => {
    await activeStore?.configure({ permissionRuleSetId });
  },
  usableModels: () => usableModels,
  selectedModelKey: () => selectedModelKey,
  setComposerModel: async (key) => {
    const model = parseModelKey(key);
    if (model) await activeStore?.configure({ model });
  },
  selectedThinkingLevel: () => selectedThinkingLevel,
  setComposerThinkingLevel: async (reasoningLevel) => {
    await activeStore?.configure({ reasoningLevel });
  },
  selectedMode: () => selectedMode,
  setComposerMode: async (mode) => {
    await activeStore?.configure({ mode });
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
      void getDesktopBridge()
        ?.app.reportRendererCoreReady()
        .catch(() => undefined);
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
{/if}
