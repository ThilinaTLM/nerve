import type { AgentRecord, ModelInfo } from "$lib/api";
import {
  getAuthProviders,
  getClientConfig,
  getModels,
  getSettings,
  getSubscriptionUsage,
  type UpdateSettingsRequest,
  updateSettings,
} from "$lib/api";
import type { ThemePreference } from "$lib/app/layout/layout-state.svelte";
import {
  applyTheme,
  applyZoomLevel,
  clampZoomLevel,
} from "$lib/app/layout/layout-state.svelte";
import { modelKey, scopedUsableModelOptions } from "$lib/core/utils/model";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { usageState } from "$lib/features/usage/state/usage-state.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  clampThinkingLevelForModel,
  resolveNewAgentComposerSelection,
} from "./agent-selection-defaults";
export type SettingsSaveOptions = {
  immediate?: boolean;
  debounceMs?: number;
};

let pendingSettingsPatch: UpdateSettingsRequest | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveInFlight = false;
let savedServerSettingsSinceLoad = false;

function currentActiveAgent(): AgentRecord | undefined {
  return workspaceState.agents.find((agent) => agent.id === selection.agentId);
}

function currentSelectedModelInfo(): ModelInfo | undefined {
  return settingsState.models.find(
    (model) => modelKey(model) === conversationState.selectedModelKey,
  );
}

export async function openSettingsPane() {
  addCenterTab({ kind: "settings", id: "settings" });
  setActiveCenterTab({ kind: "settings", id: "settings" });
  await loadSettingsPanel();
}

export async function selectCenterSettingsTab() {
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

export async function loadSettingsPanel() {
  const [settings, modelList, auth, subscriptionUsage] = await Promise.all([
    getSettings(),
    getModels(),
    getAuthProviders(),
    getSubscriptionUsage().catch(() => []),
  ]);
  settingsState.settingsDraft = settings;
  applyZoomLevel(settings.ui.zoomLevel);
  settingsState.models = modelList;
  settingsState.authProviders = auth;
  usageState.subscriptionUsage = Object.fromEntries(
    subscriptionUsage.map((usage) => [usage.provider, usage]),
  );
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
  if (!hasPendingSettingsSave()) {
    savedServerSettingsSinceLoad = false;
    settingsState.settingsSaveStatus = "idle";
    settingsState.settingsMessage = undefined;
  }
}

function mergeSettingsPatch(
  base: UpdateSettingsRequest | undefined,
  patch: UpdateSettingsRequest,
): UpdateSettingsRequest {
  const next: UpdateSettingsRequest = { ...(base ?? {}), ...patch };
  if (base?.server || patch.server) {
    next.server = { ...(base?.server ?? {}), ...(patch.server ?? {}) };
  }
  if (base?.ui || patch.ui) {
    next.ui = { ...(base?.ui ?? {}), ...(patch.ui ?? {}) };
  }
  if (base?.desktop || patch.desktop) {
    next.desktop = { ...(base?.desktop ?? {}), ...(patch.desktop ?? {}) };
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
  return next;
}

function patchTouchesServer(patch: UpdateSettingsRequest | undefined): boolean {
  return Boolean(patch?.server && Object.keys(patch.server).length > 0);
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

export function setTheme(preference: ThemePreference) {
  applyTheme(preference);
}

export function setUiZoomLevel(level: number) {
  const next = clampZoomLevel(level);
  applyZoomLevel(next);
  if (settingsState.settingsDraft) {
    settingsState.settingsDraft.ui.zoomLevel = next;
  }
  queueSettingsSave({ ui: { zoomLevel: next } });
}
