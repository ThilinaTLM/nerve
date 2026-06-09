import { setMode, userPrefersMode } from "mode-watcher";

export type ThemePreference = "system" | "light" | "dark";
export type UtilityTab = "history" | "processes" | "info" | "git";

export const selection = $state({
  projectId: undefined as string | undefined,
  conversationId: undefined as string | undefined,
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

export const MIN_ZOOM_LEVEL = -8;
export const MAX_ZOOM_LEVEL = 8;
export const ZOOM_BASE = 1.1;

export const themeState = $state({
  preference: "system" as ThemePreference,
});

export const zoomState = $state({
  level: 0,
});

// Theme switching is delegated to mode-watcher, which toggles the `.dark` class
// on <html>, follows the system preference, and persists the choice.
export function applyTheme(preference = themeState.preference) {
  themeState.preference = preference;
  setMode(preference);
}

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.round(level)));
}

export function zoomScaleForLevel(level: number): number {
  return ZOOM_BASE ** clampZoomLevel(level);
}

export function zoomPercentForLevel(level: number): number {
  return Math.round(zoomScaleForLevel(level) * 100);
}

export function applyZoomLevel(level: number) {
  const next = clampZoomLevel(level);
  zoomState.level = next;
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--nerve-zoom-scale",
    zoomScaleForLevel(next).toFixed(4),
  );
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
  selection.conversationId = undefined;
  selection.agentId = undefined;
  selection.entryId = undefined;
}
