import {
  getApplicationConfiguration,
  getAuthProviders,
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
  applyZoomLevel,
  clampZoomLevel,
} from "$lib/platform/appearance/appearance.svelte";
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
import { selectProject } from "$lib/application/workspace/workspace-actions.svelte";
import {
  resolveSettingsPageId,
  resolveSettingsTarget,
} from "$lib/features/settings/registry/settings-pages";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
export type SettingsSaveOptions = {
  immediate?: boolean;
  debounceMs?: number;
};

let pendingSettingsPatch: UpdateSettingsRequest | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveInFlight = false;
let savedServerSettingsSinceLoad = false;
let skillsRequestId = 0;
let coreSettingsLoadInFlight: Promise<void> | undefined;
let settingsLoadInFlight: Promise<void> | undefined;
let settingsReloadRequested = false;

/** Where to land inside a page: a detail item and/or an anchored section. */
export type SettingsPaneOptions = { item?: string; section?: string };

function targetSettingsPage(
  pageId?: string,
  options: SettingsPaneOptions = {},
) {
  const target = resolveSettingsTarget("user", {
    pageId,
    item: options.item,
    section: options.section,
  });
  if (target.pageId) {
    settingsState.activePageId = target.pageId;
    settingsState.activeItemId = target.item ?? "";
  }
  if (target.section) settingsState.activeSectionId = target.section;
}

/** Opens (or focuses) one project's settings tab, in that project's session. */
export async function openProjectSettingsPane(
  projectId: string,
  pageId?: string,
  options: SettingsPaneOptions = {},
) {
  if (!workspaceState.projects.some((project) => project.id === projectId))
    return;
  await selectProject(projectId, { deferTabActivation: true });
  const view = settingsState.projectViews[projectId];
  const target = resolveSettingsTarget("project", {
    pageId,
    item: options.item,
    section: options.section,
  });
  settingsState.projectViews[projectId] = target.pageId
    ? {
        pageId: target.pageId,
        sectionId: target.section ?? "",
        itemId: target.item ?? "",
      }
    : {
        pageId: view?.pageId ?? resolveSettingsPageId("project", undefined),
        sectionId: target.section ?? view?.sectionId ?? "",
        itemId: view?.itemId ?? "",
      };
  const tab = { kind: "project-settings" as const, id: projectId };
  addCenterTab(tab);
  setActiveCenterTab(tab);
  await loadSettingsPanel();
}

export async function openSettingsPane(
  pageId?: string,
  options: SettingsPaneOptions = {},
) {
  targetSettingsPage(pageId, options);
  addCenterTab({ kind: "settings", id: "settings" });
  setActiveCenterTab({ kind: "settings", id: "settings" });
  await loadSettingsPanel();
}

export async function selectCenterSettingsTab(
  pageId?: string,
  options: SettingsPaneOptions = {},
) {
  targetSettingsPage(pageId, options);
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
    settingsState.skills = result.skills;
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
  applyZoomLevel(settings.ui.zoomLevel);
  settingsState.models = modelList;
  settingsState.authProviders = auth;
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

/** Merges preserved settings patches without losing concurrent nested changes. */
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
  return next;
}

function patchTouchesServer(patch: UpdateSettingsRequest | undefined): boolean {
  return Boolean(
    patch?.application && Object.keys(patch.application).length > 0,
  );
}

function clearSaveTimer() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
}

export function hasPendingSettingsSave(): boolean {
  return Boolean(pendingSettingsPatch || saveTimer || saveInFlight);
}

export function queueSettingsSave(
  patch: UpdateSettingsRequest,
  options: SettingsSaveOptions = {},
) {
  pendingSettingsPatch = mergeSettingsPatch(pendingSettingsPatch, patch);
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

export { setTheme } from "$lib/platform/appearance/appearance.svelte";

export function setUiZoomLevel(level: number) {
  const next = clampZoomLevel(level);
  applyZoomLevel(next);
  if (settingsState.settingsDraft) {
    settingsState.settingsDraft.ui.zoomLevel = next;
  }
  queueSettingsSave({ ui: { zoomLevel: next } });
}
