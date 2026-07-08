import { getContext, setContext } from "svelte";

export type SandboxCenterMode = "dashboard" | "sandbox" | "settings";

const CONTEXT_KEY = Symbol("nerve.sandboxManager.center");
const STORAGE_KEY = "nerve.sandboxManager.selectedSandbox";

function readStoredSandbox(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem(STORAGE_KEY) ?? undefined;
}

function writeStoredSandbox(id: string | undefined): void {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
}

/**
 * Global center-view state for the single-page sandbox manager. Replaces the
 * former client-side routes: the center either shows the summary dashboard, a
 * selected sandbox's workspace, or the settings panel (as a center tab).
 */
export class SandboxCenterState {
  mode = $state<SandboxCenterMode>("dashboard");
  selectedSandboxId = $state<string | undefined>(undefined);
  settingsOpen = $state(false);
  settingsSection = $state<string>("");

  private readonly onSelect?: (id: string | undefined) => void;

  constructor(options?: { onSelect?: (id: string | undefined) => void }) {
    this.onSelect = options?.onSelect;
  }

  /** Restore the persisted selection on boot. */
  restore(): void {
    const stored = readStoredSandbox();
    if (stored) this.openSandbox(stored);
    else this.openDashboard();
  }

  openDashboard(): void {
    this.mode = "dashboard";
  }

  openSandbox(id: string): void {
    this.mode = "sandbox";
    if (this.selectedSandboxId !== id) {
      this.selectedSandboxId = id;
      writeStoredSandbox(id);
      this.onSelect?.(id);
    }
  }

  openSettings(section?: string): void {
    if (section) this.settingsSection = section;
    this.settingsOpen = true;
    this.mode = "settings";
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.mode = this.selectedSandboxId ? "sandbox" : "dashboard";
  }

  /** Clear the current selection (e.g. after the sandbox is removed). */
  clearSelection(): void {
    if (!this.selectedSandboxId) return;
    this.selectedSandboxId = undefined;
    writeStoredSandbox(undefined);
    this.onSelect?.(undefined);
    if (this.mode === "sandbox") this.mode = "dashboard";
  }
}

export function setSandboxCenter(
  state: SandboxCenterState,
): SandboxCenterState {
  return setContext(CONTEXT_KEY, state);
}

export function useSandboxCenter(): SandboxCenterState {
  const state = getContext<SandboxCenterState>(CONTEXT_KEY);
  if (!state)
    throw new Error("SandboxCenterState is not available in this context");
  return state;
}
