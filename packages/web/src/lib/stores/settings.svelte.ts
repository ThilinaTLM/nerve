import { toast } from "svelte-sonner";
import {
  getAuthProviders,
  getModels,
  getSettings,
  updateSettings,
} from "../api";
import type { ThemePreference } from "../state/app-state.svelte";
import { applyTheme } from "../state/app-state.svelte";
import { modelKey, usableModelOptions } from "../utils/model";
import { currentActiveAgent } from "./composer-config.svelte";
import { workbenchState } from "./workbench/state.svelte";

let navigateToSettings: (() => void) | undefined;

export function setSettingsNavigation(callback: () => void) {
  navigateToSettings = callback;
}

export function navigateToSettingsPanel() {
  navigateToSettings?.();
}

export async function loadSettingsPanel() {
  const [settings, modelList, auth] = await Promise.all([
    getSettings(),
    getModels(),
    getAuthProviders(),
  ]);
  workbenchState.settingsDraft = settings;
  workbenchState.models = modelList;
  workbenchState.authProviders = auth;
  workbenchState.selectedMode =
    currentActiveAgent()?.mode ?? settings.defaultMode;
  workbenchState.selectedPermissionLevel =
    currentActiveAgent()?.permissionLevel ?? settings.defaultPermissionLevel;
  const usable = usableModelOptions(modelList, auth);
  const activeModel = currentActiveAgent()?.model;
  if (
    activeModel &&
    usable.some((model) => modelKey(model) === modelKey(activeModel))
  ) {
    workbenchState.selectedModelKey = modelKey(activeModel);
  } else if (
    !usable.some((model) => modelKey(model) === workbenchState.selectedModelKey)
  ) {
    workbenchState.selectedModelKey =
      usable.length > 0 ? modelKey(usable[0]) : "";
  }
}

export async function saveSettings() {
  if (!workbenchState.settingsDraft) return;
  workbenchState.settingsMessage = undefined;
  try {
    workbenchState.settingsDraft = await updateSettings(
      workbenchState.settingsDraft,
    );
    workbenchState.settingsMessage =
      "Settings saved. Server host/port changes apply after daemon restart.";
    toast.success("Settings saved", {
      description: "Host/port changes apply after daemon restart.",
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workbenchState.settingsMessage = message;
    toast.error("Could not save settings", { description: message });
  }
}

export function setTheme(preference: ThemePreference) {
  applyTheme(preference);
}
