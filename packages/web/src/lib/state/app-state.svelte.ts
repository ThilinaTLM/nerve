import { setMode, userPrefersMode } from "mode-watcher";

export type ThemePreference = "system" | "light" | "dark";
export type UtilityTab = "history" | "processes" | "info";

export const selection = $state({
  projectId: undefined as string | undefined,
  sessionId: undefined as string | undefined,
  agentId: undefined as string | undefined,
  entryId: undefined as string | undefined,
});

export const layout = $state({
  utilityTab: "info" as UtilityTab,
  sidebarCollapsed: false,
  utilityCollapsed: false,
});

export const eventBuffer = $state({
  items: [] as string[],
});

export const composerDraft = $state({
  text: "",
  projectDir: "",
});

export const themeState = $state({
  preference: "system" as ThemePreference,
});

// Theme switching is delegated to mode-watcher, which toggles the `.dark` class
// on <html>, follows the system preference, and persists the choice.
export function applyTheme(preference = themeState.preference) {
  themeState.preference = preference;
  setMode(preference);
}

export function loadSidebarCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("nerve.sidebarCollapsed") === "1";
}

export function setSidebarCollapsed(collapsed: boolean) {
  layout.sidebarCollapsed = collapsed;
  if (typeof localStorage !== "undefined")
    localStorage.setItem("nerve.sidebarCollapsed", collapsed ? "1" : "0");
}

export function loadUtilityCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("nerve.utilityCollapsed") === "1";
}

export function setUtilityCollapsed(collapsed: boolean) {
  layout.utilityCollapsed = collapsed;
  if (typeof localStorage !== "undefined")
    localStorage.setItem("nerve.utilityCollapsed", collapsed ? "1" : "0");
}

export function loadThemePreference(): ThemePreference {
  // mode-watcher restores the persisted mode on mount; mirror it into state.
  return userPrefersMode.current ?? "system";
}

export function pushEventPreview(serialized: string) {
  eventBuffer.items = [serialized, ...eventBuffer.items].slice(0, 16);
}

export function resetSelection() {
  selection.projectId = undefined;
  selection.sessionId = undefined;
  selection.agentId = undefined;
  selection.entryId = undefined;
}
