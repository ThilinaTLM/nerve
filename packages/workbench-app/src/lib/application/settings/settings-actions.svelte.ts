import {
  modelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import type {
  AgentRecord,
  ColorMode,
  ColorTheme,
  ModelInfo,
  Settings,
} from "$lib/api";
import {
  getApplicationConfiguration,
  getAuthProviders,
  getClientConfig,
  getModels,
  getSettings,
  listAvailableSkills,
  getSubscriptionUsage,
  type UpdateApplicationConfigurationRequest,
  type UpdateSettingsRequest,
  updateApplicationConfiguration,
  updateSettings,
} from "$lib/api";
import {
  applyAppearance,
  applyColorMode,
  applyColorTheme,
  applyZoomLevel,
  clampZoomLevel,
} from "$lib/platform/appearance/appearance.svelte";
import {
  clampThinkingLevelForModel,
  resolveNewAgentComposerSelection,
} from "$lib/application/preferences/agent-selection";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  getDesktopDaemonCapability,
  restartDesktopDaemon,
} from "$lib/platform/desktop/desktop-bridge.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { usageState } from "$lib/features/usage/state/usage-state.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
export type SettingsSaveOptions = {
  immediate?: boolean;
  debounceMs?: number;
};

type LastAgentSelectionPatch = Partial<Settings["lastAgentSelection"]>;

export function rememberLastAgentSelection(
  patch: LastAgentSelectionPatch,
): void {
  const settings = settingsState.settingsDraft;
  if (!settings?.rememberLastAgentSelection) return;
  settings.lastAgentSelection = {
    ...settings.lastAgentSelection,
    ...patch,
  };
  queueSettingsSave({ lastAgentSelection: patch }, { immediate: true });
}

let pendingSettingsPatch: UpdateSettingsRequest | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveInFlight = false;
let savedServerSettingsSinceLoad = false;
let skillsRequestId = 0;
let coreSettingsLoadInFlight: Promise<void> | undefined;
let settingsLoadInFlight: Promise<void> | undefined;
let settingsReloadRequested = false;

function currentActiveAgent(): AgentRecord | undefined {
  return workspaceState.agents.find((agent) => agent.id === selection.agentId);
}

function currentSelectedModelInfo(): ModelInfo | undefined {
  return settingsState.models.find(
    (model) => modelKey(model) === conversationState.selectedModelKey,
  );
}

function targetSettingsPage(pageId?: string, sectionId?: string) {
  if (pageId) settingsState.activePageId = pageId;
  if (sectionId) settingsState.activeSectionId = sectionId;
}

export async function openSettingsPane(pageId?: string, sectionId?: string) {
  targetSettingsPage(pageId, sectionId);
  addCenterTab({ kind: "settings", id: "settings" });
  setActiveCenterTab({ kind: "settings", id: "settings" });
  await loadSettingsPanel();
}

export async function selectCenterSettingsTab(
  pageId?: string,
  sectionId?: string,
) {
  targetSettingsPage(pageId, sectionId);
  addCenterTab({ kind: "settings", id: "settings" });
  setActiveCenterTab({ kind: "settings", id: "settings" });
  if (!settingsState.settingsDraft) await loadSettingsPanel();
}

export function closeSettingsTab() {
  const tab = { kind: "settings" as const, id: "settings" as const };
  const closingActive = workspaceState.activeCenterTab?.kind === "settings";
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  if (closingActive) void selectCenterTab(fallback);
}

export async function refreshSubscriptionUsage() {
  const subscriptionUsage = await getSubscriptionUsage();
  usageState.subscriptionUsage = Object.fromEntries(
    subscriptionUsage.map((usage) => [usage.provider, usage]),
  );
  return subscriptionUsage;
}

export async function loadSettingsSkills(projectId = selection.projectId) {
  const requestId = ++skillsRequestId;
  settingsState.skillsLoading = true;
  settingsState.skillsError = undefined;
  settingsState.skillsProjectId = projectId ?? null;
  try {
    const result = await listAvailableSkills(projectId);
    if (requestId !== skillsRequestId) return;
    settingsState.agentBrowserSkills = result.agentBrowserSkills;
    settingsState.globalSkills = result.globalSkills;
    settingsState.projectSkills = result.projectSkills;
  } catch (error) {
    if (requestId !== skillsRequestId) return;
    settingsState.skillsError =
      error instanceof Error ? error.message : "Could not load skills.";
  } finally {
    if (requestId === skillsRequestId) settingsState.skillsLoading = false;
  }
}

async function performCoreSettingsLoad(): Promise<void> {
  const [settings, applicationConfiguration, modelList, auth, capability] =
    await Promise.all([
      getSettings(),
      getApplicationConfiguration(),
      getModels(),
      getAuthProviders(),
      getDesktopDaemonCapability(),
    ]);
  settingsState.settingsDraft = settings;
  settingsState.applicationConfiguration = applicationConfiguration;
  settingsState.daemonCapability = capability;
  applyAppearance(settings.ui.theme, settings.ui.colorMode);
  applyZoomLevel(settings.ui.zoomLevel);
  settingsState.models = modelList;
  settingsState.authProviders = auth;
  reconcileComposerSelectionFromSettings();
  if (!hasPendingSettingsSave()) {
    savedServerSettingsSinceLoad = false;
    settingsState.settingsSaveStatus = "idle";
    settingsState.settingsMessage = undefined;
  }
}

export function loadCoreSettings(): Promise<void> {
  if (coreSettingsLoadInFlight) return coreSettingsLoadInFlight;
  coreSettingsLoadInFlight = performCoreSettingsLoad().finally(() => {
    coreSettingsLoadInFlight = undefined;
  });
  return coreSettingsLoadInFlight;
}

export function reconcileComposerSelectionFromSettings(): void {
  const settings = settingsState.settingsDraft;
  if (!settings) return;
  const modelList = settingsState.models;
  const auth = settingsState.authProviders;
  const usable = scopedUsableModelOptions(
    modelList,
    auth,
    settings.scopedModels,
  );
  const defaultSelection = resolveNewAgentComposerSelection(
    settings,
    modelList,
    auth,
  );
  const activeAgent = currentActiveAgent();
  if (activeAgent) {
    conversationState.selectedMode = activeAgent.mode;
    conversationState.selectedPermissionLevel = activeAgent.permissionLevel;
    const activeModel = activeAgent.model;
    if (
      activeModel &&
      usable.some((model) => modelKey(model) === modelKey(activeModel))
    ) {
      conversationState.selectedModelKey = modelKey(activeModel);
      conversationState.selectedThinkingLevel = activeAgent.thinkingLevel;
    } else {
      conversationState.selectedModelKey = defaultSelection.selectedModelKey;
      conversationState.selectedThinkingLevel =
        defaultSelection.selectedThinkingLevel;
    }
  } else {
    conversationState.selectedMode = defaultSelection.selectedMode;
    conversationState.selectedPermissionLevel =
      defaultSelection.selectedPermissionLevel;
    conversationState.selectedModelKey = defaultSelection.selectedModelKey;
    conversationState.selectedThinkingLevel =
      defaultSelection.selectedThinkingLevel;
  }
  conversationState.selectedThinkingLevel = clampThinkingLevelForModel(
    conversationState.selectedThinkingLevel,
    currentSelectedModelInfo(),
  );
}

export function refreshAncillarySettingsData(): void {
  void refreshSubscriptionUsage().catch(() => undefined);
  void loadSettingsSkills();
}

async function runSettingsLoadCycle(
  coreLoadAtStart: Promise<void> | undefined,
): Promise<void> {
  if (coreLoadAtStart) await coreLoadAtStart;
  do {
    settingsReloadRequested = false;
    await loadCoreSettings();
    refreshAncillarySettingsData();
  } while (settingsReloadRequested);
}

export function loadSettingsPanel(): Promise<void> {
  if (settingsLoadInFlight) {
    settingsReloadRequested = true;
    return settingsLoadInFlight;
  }
  settingsLoadInFlight = runSettingsLoadCycle(coreSettingsLoadInFlight).finally(
    () => {
      settingsLoadInFlight = undefined;
    },
  );
  return settingsLoadInFlight;
}

function mergeSettingsPatch(
  base: UpdateSettingsRequest | undefined,
  patch: UpdateSettingsRequest,
): UpdateSettingsRequest {
  const next: UpdateSettingsRequest = { ...(base ?? {}), ...patch };
  if (base?.application || patch.application) {
    next.application = {
      ...(base?.application ?? {}),
      ...(patch.application ?? {}),
      ...(base?.application?.network || patch.application?.network
        ? {
            network: {
              ...(base?.application?.network ?? {}),
              ...(patch.application?.network ?? {}),
            },
          }
        : {}),
      ...(base?.application?.diagnostics || patch.application?.diagnostics
        ? {
            diagnostics: {
              ...(base?.application?.diagnostics ?? {}),
              ...(patch.application?.diagnostics ?? {}),
            },
          }
        : {}),
      ...(base?.application?.daemon || patch.application?.daemon
        ? {
            daemon: {
              ...(base?.application?.daemon ?? {}),
              ...(patch.application?.daemon ?? {}),
            },
          }
        : {}),
      ...(base?.application?.electron || patch.application?.electron
        ? {
            electron: {
              ...(base?.application?.electron ?? {}),
              ...(patch.application?.electron ?? {}),
            },
          }
        : {}),
    };
  }
  if (base?.ui || patch.ui) {
    next.ui = { ...(base?.ui ?? {}), ...(patch.ui ?? {}) };
  }
  if (base?.desktop || patch.desktop) {
    next.desktop = { ...(base?.desktop ?? {}), ...(patch.desktop ?? {}) };
  }
  if (base?.notifications || patch.notifications) {
    next.notifications = {
      ...(base?.notifications ?? {}),
      ...(patch.notifications ?? {}),
      ...(base?.notifications?.events || patch.notifications?.events
        ? {
            events: {
              ...(base?.notifications?.events ?? {}),
              ...(patch.notifications?.events ?? {}),
            },
          }
        : {}),
    };
  }
  if (base?.lastAgentSelection || patch.lastAgentSelection) {
    next.lastAgentSelection = {
      ...(base?.lastAgentSelection ?? {}),
      ...(patch.lastAgentSelection ?? {}),
    };
  }
  if (base?.exploreAgent || patch.exploreAgent) {
    next.exploreAgent = {
      ...(base?.exploreAgent ?? {}),
      ...(patch.exploreAgent ?? {}),
    };
  }
  if (base?.compaction || patch.compaction) {
    next.compaction = {
      ...(base?.compaction ?? {}),
      ...(patch.compaction ?? {}),
    };
  }
  if (base?.runtime || patch.runtime) {
    next.runtime = {
      ...(base?.runtime ?? {}),
      ...(patch.runtime ?? {}),
    };
  }
  if (base?.providers || patch.providers) {
    next.providers = {
      ...(base?.providers ?? {}),
      ...(patch.providers ?? {}),
    };
  }
  if (base?.skills || patch.skills) {
    next.skills = {
      ...(base?.skills ?? {}),
      ...(patch.skills ?? {}),
      ...(base?.skills?.agentBrowser || patch.skills?.agentBrowser
        ? {
            agentBrowser: {
              ...(base?.skills?.agentBrowser ?? {}),
              ...(patch.skills?.agentBrowser ?? {}),
            },
          }
        : {}),
    };
  }
  if (base?.tools || patch.tools) {
    next.tools = {
      ...(base?.tools ?? {}),
      ...(patch.tools ?? {}),
      ...(base?.tools?.bash || patch.tools?.bash
        ? {
            bash: {
              ...(base?.tools?.bash ?? {}),
              ...(patch.tools?.bash ?? {}),
              ...(base?.tools?.bash?.autoPromotion ||
              patch.tools?.bash?.autoPromotion
                ? {
                    autoPromotion: {
                      ...(base?.tools?.bash?.autoPromotion ?? {}),
                      ...(patch.tools?.bash?.autoPromotion ?? {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(["jira", "confluence", "web", "imageExplanation"] as const).reduce(
        (branches, key) =>
          base?.tools?.[key] || patch.tools?.[key]
            ? {
                ...branches,
                [key]: {
                  ...(base?.tools?.[key] ?? {}),
                  ...(patch.tools?.[key] ?? {}),
                },
              }
            : branches,
        {},
      ),
    };
  }
  return next;
}

function patchTouchesServer(patch: UpdateSettingsRequest | undefined): boolean {
  return Boolean(
    patch?.application && Object.keys(patch.application).length > 0,
  );
}

function patchTouchesRuntime(
  patch: UpdateSettingsRequest | undefined,
): boolean {
  return Boolean(patch?.runtime && Object.keys(patch.runtime).length > 0);
}

function clearSaveTimer() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
}

export function hasPendingSettingsSave(): boolean {
  return Boolean(pendingSettingsPatch || saveTimer || saveInFlight);
}

function reconcileSelectedModelForScope(
  scopedModels: UpdateSettingsRequest["scopedModels"],
) {
  const usable = scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    scopedModels,
  );
  if (
    usable.some(
      (model) => modelKey(model) === conversationState.selectedModelKey,
    )
  ) {
    return;
  }
  conversationState.selectedModelKey =
    usable.length > 0 ? modelKey(usable[0]) : "";
  conversationState.selectedThinkingLevel = clampThinkingLevelForModel(
    conversationState.selectedThinkingLevel,
    currentSelectedModelInfo(),
  );
}

export function queueSettingsSave(
  patch: UpdateSettingsRequest,
  options: SettingsSaveOptions = {},
) {
  pendingSettingsPatch = mergeSettingsPatch(pendingSettingsPatch, patch);
  if ("scopedModels" in patch)
    reconcileSelectedModelForScope(patch.scopedModels);
  settingsState.settingsSaveStatus = "dirty";
  settingsState.settingsMessage = "Unsaved changes";
  clearSaveTimer();

  if (options.immediate) {
    void flushSettingsSave();
    return;
  }

  saveTimer = setTimeout(
    () => void flushSettingsSave(),
    options.debounceMs ?? 600,
  );
}

export async function flushSettingsSave() {
  clearSaveTimer();
  if (saveInFlight || !pendingSettingsPatch) return;

  const patch = pendingSettingsPatch;
  pendingSettingsPatch = undefined;
  saveInFlight = true;
  settingsState.settingsSaveStatus = "saving";
  settingsState.settingsMessage = "Saving…";

  try {
    const saved = await updateSettings(patch);
    savedServerSettingsSinceLoad ||= patchTouchesServer(patch);
    if (patchTouchesRuntime(patch)) {
      const config = await getClientConfig().catch(() => undefined);
      if (config) {
        workspaceState.config = config;
        workspaceState.status = config.status;
      }
    }
    if (!pendingSettingsPatch) {
      settingsState.settingsDraft = saved;
      settingsState.settingsSaveStatus = "saved";
      settingsState.settingsMessage = savedServerSettingsSinceLoad
        ? "Saved — restart the daemon to apply server binding changes."
        : "Saved";
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    pendingSettingsPatch = mergeSettingsPatch(
      patch,
      pendingSettingsPatch ?? {},
    );
    settingsState.settingsSaveStatus = "error";
    settingsState.settingsMessage = message;
    notify.error("Could not save settings", { description: message });
  } finally {
    saveInFlight = false;
    if (pendingSettingsPatch && settingsState.settingsSaveStatus !== "error") {
      void flushSettingsSave();
    }
  }
}

export async function saveApplicationConfiguration(
  patch: UpdateApplicationConfigurationRequest,
): Promise<void> {
  settingsState.settingsSaveStatus = "saving";
  settingsState.settingsMessage = "Saving…";
  try {
    const snapshot = await updateApplicationConfiguration(patch);
    settingsState.applicationConfiguration = snapshot;
    const settings = await getSettings();
    settingsState.settingsDraft = settings;
    settingsState.settingsSaveStatus = "saved";
    settingsState.settingsMessage = "Saved";
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    settingsState.settingsSaveStatus = "error";
    settingsState.settingsMessage = message;
    notify.error("Could not save configuration", { description: message });
  }
}

export async function restartOwnedDaemon(): Promise<void> {
  if (settingsState.daemonRestarting) return;
  settingsState.daemonRestarting = true;
  settingsState.settingsMessage = "Restarting daemon…";
  try {
    const restarted = await restartDesktopDaemon();
    if (!restarted) throw new Error("Daemon restart is not available here.");
    await loadCoreSettings();
    settingsState.settingsSaveStatus = "saved";
    settingsState.settingsMessage = "Daemon restarted";
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    settingsState.settingsSaveStatus = "error";
    settingsState.settingsMessage = message;
    notify.error("Could not restart daemon", { description: message });
  } finally {
    settingsState.daemonRestarting = false;
  }
}

export function setColorTheme(theme: ColorTheme): void {
  applyColorTheme(theme);
}

export function setColorMode(colorMode: ColorMode): void {
  applyColorMode(colorMode);
}

export function setUiZoomLevel(level: number) {
  const next = clampZoomLevel(level);
  applyZoomLevel(next);
  if (settingsState.settingsDraft) {
    settingsState.settingsDraft.ui.zoomLevel = next;
  }
  queueSettingsSave({ ui: { zoomLevel: next } });
}
