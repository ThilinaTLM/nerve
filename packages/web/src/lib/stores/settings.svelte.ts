import { notify } from "$lib/notifications/notify.svelte";
import {
  getAuthProviders,
  getModels,
  getSettings,
  getSubscriptionUsage,
  type UpdateSettingsRequest,
  updateSettings,
} from "../api";
import type { ThemePreference } from "../state/app-state.svelte";
import {
  applyTheme,
  applyZoomLevel,
  clampZoomLevel,
} from "../state/app-state.svelte";
import { modelKey, scopedUsableModelOptions } from "../utils/model";
import {
  clampThinkingLevelForModel,
  currentActiveAgent,
  selectedModelInfo,
} from "./composer-config.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "./workbench/center-tabs.svelte";
import { workbenchState } from "./workbench/state.svelte";

export type SettingsSaveOptions = {
  immediate?: boolean;
  debounceMs?: number;
};

let pendingSettingsPatch: UpdateSettingsRequest | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveInFlight = false;
let savedServerSettingsSinceLoad = false;

export async function openSettingsPane() {
  addCenterTab({ kind: "settings", id: "settings" });
  setActiveCenterTab({ kind: "settings", id: "settings" });
  await loadSettingsPanel();
}

export async function selectCenterSettingsTab() {
  addCenterTab({ kind: "settings", id: "settings" });
  setActiveCenterTab({ kind: "settings", id: "settings" });
  if (!workbenchState.settingsDraft) await loadSettingsPanel();
}

export function closeSettingsTab() {
  const tab = { kind: "settings" as const, id: "settings" as const };
  const closingActive = workbenchState.activeCenterTab?.kind === "settings";
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  if (closingActive) void selectCenterTab(fallback);
}

export async function refreshSubscriptionUsage() {
  const subscriptionUsage = await getSubscriptionUsage();
  workbenchState.subscriptionUsage = Object.fromEntries(
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
  workbenchState.settingsDraft = settings;
  applyZoomLevel(settings.ui.zoomLevel);
  workbenchState.models = modelList;
  workbenchState.authProviders = auth;
  workbenchState.subscriptionUsage = Object.fromEntries(
    subscriptionUsage.map((usage) => [usage.provider, usage]),
  );
  workbenchState.selectedMode =
    currentActiveAgent()?.mode ?? settings.defaultMode;
  workbenchState.selectedPermissionLevel =
    currentActiveAgent()?.permissionLevel ?? settings.defaultPermissionLevel;
  const usable = scopedUsableModelOptions(
    modelList,
    auth,
    settings.scopedModels,
  );
  const activeModel = currentActiveAgent()?.model;
  if (
    activeModel &&
    usable.some((model) => modelKey(model) === modelKey(activeModel))
  ) {
    workbenchState.selectedModelKey = modelKey(activeModel);
    workbenchState.selectedThinkingLevel =
      currentActiveAgent()?.thinkingLevel ?? "off";
  } else if (
    !usable.some((model) => modelKey(model) === workbenchState.selectedModelKey)
  ) {
    workbenchState.selectedModelKey =
      usable.length > 0 ? modelKey(usable[0]) : "";
  }
  workbenchState.selectedThinkingLevel = clampThinkingLevelForModel(
    workbenchState.selectedThinkingLevel,
    selectedModelInfo(),
  );
  if (!hasPendingSettingsSave()) {
    savedServerSettingsSinceLoad = false;
    workbenchState.settingsSaveStatus = "idle";
    workbenchState.settingsMessage = undefined;
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
  return next;
}

function patchTouchesServer(patch: UpdateSettingsRequest | undefined): boolean {
  return Boolean(patch?.server && Object.keys(patch.server).length > 0);
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
    workbenchState.models,
    workbenchState.authProviders,
    scopedModels,
  );
  if (
    usable.some((model) => modelKey(model) === workbenchState.selectedModelKey)
  ) {
    return;
  }
  workbenchState.selectedModelKey =
    usable.length > 0 ? modelKey(usable[0]) : "";
  workbenchState.selectedThinkingLevel = clampThinkingLevelForModel(
    workbenchState.selectedThinkingLevel,
    selectedModelInfo(),
  );
}

export function queueSettingsSave(
  patch: UpdateSettingsRequest,
  options: SettingsSaveOptions = {},
) {
  pendingSettingsPatch = mergeSettingsPatch(pendingSettingsPatch, patch);
  if ("scopedModels" in patch)
    reconcileSelectedModelForScope(patch.scopedModels);
  workbenchState.settingsSaveStatus = "dirty";
  workbenchState.settingsMessage = "Unsaved changes";
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
  workbenchState.settingsSaveStatus = "saving";
  workbenchState.settingsMessage = "Saving…";

  try {
    const saved = await updateSettings(patch);
    savedServerSettingsSinceLoad ||= patchTouchesServer(patch);
    if (!pendingSettingsPatch) {
      workbenchState.settingsDraft = saved;
      workbenchState.settingsSaveStatus = "saved";
      workbenchState.settingsMessage = savedServerSettingsSinceLoad
        ? "Saved — restart the daemon to apply server binding changes."
        : "Saved";
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    pendingSettingsPatch = mergeSettingsPatch(
      patch,
      pendingSettingsPatch ?? {},
    );
    workbenchState.settingsSaveStatus = "error";
    workbenchState.settingsMessage = message;
    notify.error("Could not save settings", { description: message });
  } finally {
    saveInFlight = false;
    if (pendingSettingsPatch && workbenchState.settingsSaveStatus !== "error") {
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
  if (workbenchState.settingsDraft) {
    workbenchState.settingsDraft.ui.zoomLevel = next;
  }
  queueSettingsSave({ ui: { zoomLevel: next } });
}
