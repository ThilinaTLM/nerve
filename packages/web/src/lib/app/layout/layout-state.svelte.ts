import { setMode, userPrefersMode } from "mode-watcher";

export type ThemePreference = "system" | "light" | "dark";
export type UtilityTab = "tasks" | "info" | "git";

export const layout = $state({
  utilityTab: "git" as UtilityTab,
  // Desktop (>= 1024px) collapse model — persisted.
  sidebarCollapsed: false,
  utilityCollapsed: false,
  // Compact (< 1024px) overlay-drawer model — ephemeral, never persisted.
  navDrawerOpen: false,
  utilityDrawerOpen: false,
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

export function setNavDrawerOpen(open: boolean) {
  layout.navDrawerOpen = open;
}

export function setUtilityDrawerOpen(open: boolean) {
  layout.utilityDrawerOpen = open;
}

export function openNavDrawer() {
  layout.navDrawerOpen = true;
  layout.utilityDrawerOpen = false;
}

export function openUtilityDrawer() {
  layout.utilityDrawerOpen = true;
  layout.navDrawerOpen = false;
}

export function closeDrawers() {
  layout.navDrawerOpen = false;
  layout.utilityDrawerOpen = false;
}

export function loadThemePreference(): ThemePreference {
  // mode-watcher restores the persisted mode on mount; mirror it into state.
  return userPrefersMode.current ?? "system";
}
