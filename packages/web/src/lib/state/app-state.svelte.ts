export type ThemePreference = "system" | "light" | "dark";
export type UtilityTab = "history" | "processes" | "info";

export const selection = $state({
  projectId: undefined as string | undefined,
  sessionId: undefined as string | undefined,
  agentId: undefined as string | undefined,
  entryId: undefined as string | undefined,
});

export const layout = $state({
  utilityTab: "history" as UtilityTab,
  sidebarCollapsed: false,
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
  resolved: "dark" as "light" | "dark",
});

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(preference = themeState.preference) {
  themeState.preference = preference;
  themeState.resolved = resolveTheme(preference);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = themeState.resolved;
    document.documentElement.dataset.themePreference = preference;
  }
  if (typeof localStorage !== "undefined")
    localStorage.setItem("nerve.theme", preference);
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

export function loadThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem("nerve.theme");
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
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
