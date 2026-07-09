const STORAGE_KEY = "nerve.sandboxManager.groupCollapse";

/** Map of sandbox group key -> collapsed. Absent key means expanded. */
export type SandboxGroupCollapseState = Record<string, boolean>;

export function loadSandboxGroupCollapseState(): SandboxGroupCollapseState {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: SandboxGroupCollapseState = {};
      for (const [key, value] of Object.entries(parsed))
        if (value === true) result[key] = true;
      return result;
    }
  } catch {
    // Ignore malformed persisted state.
  }
  return {};
}

export function saveSandboxGroupCollapseState(
  state: SandboxGroupCollapseState,
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
