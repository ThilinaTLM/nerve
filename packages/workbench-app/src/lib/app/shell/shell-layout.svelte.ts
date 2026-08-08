import {
  activateShellView,
  type DockId,
  hideShellView,
  isDockVisible,
  moveShellView,
  normalizeShellLayout,
  type PanelViewDropTarget,
  setShellDockSize,
  type ShellLayout,
  showShellView,
  toggleShellDock,
} from "$lib/presentation/shell";
import { panelViewDescriptors } from "./panel-views";

const STORAGE_KEY = "nerve.layout.v1";
const RESIZE_PERSIST_DEBOUNCE_MS = 200;

// The bottom dock starts empty and collapsed on a fresh install; Tasks lives in
// the left dock next to Conversations.
const LAYOUT_DEFAULTS = { collapsed: ["bottom"] as const };

function hydrate(): ShellLayout {
  if (typeof localStorage === "undefined")
    return normalizeShellLayout(undefined, panelViewDescriptors, {
      collapsed: [...LAYOUT_DEFAULTS.collapsed],
    });
  let raw: unknown;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    raw = stored ? JSON.parse(stored) : undefined;
  } catch {
    raw = undefined;
  }
  return normalizeShellLayout(raw, panelViewDescriptors, {
    collapsed: [...LAYOUT_DEFAULTS.collapsed],
  });
}

const state = $state<{ layout: ShellLayout }>({ layout: hydrate() });

/** Ephemeral compact-mode drawers; never persisted. */
export const shellSheets = $state({ primary: false, secondary: false });

export const shellLayout = {
  get current(): ShellLayout {
    return state.layout;
  },
};

function persist() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.layout));
  } catch {
    // Storage is best effort; the in-memory layout still applies.
  }
}

function commit(next: ShellLayout, shouldPersist = true) {
  if (next === state.layout) return;
  state.layout = next;
  if (shouldPersist) persist();
}

export type ShellPresentationSnapshot = {
  layout: ShellLayout;
  sheets: { primary: boolean; secondary: boolean };
};

export function captureShellPresentation(): ShellPresentationSnapshot {
  return {
    layout: JSON.parse(JSON.stringify(state.layout)) as ShellLayout,
    sheets: { primary: shellSheets.primary, secondary: shellSheets.secondary },
  };
}

export function restoreShellPresentation(snapshot: ShellPresentationSnapshot) {
  state.layout = normalizeShellLayout(snapshot.layout, panelViewDescriptors, {
    collapsed: [...LAYOUT_DEFAULTS.collapsed],
  });
  shellSheets.primary = snapshot.sheets.primary;
  shellSheets.secondary = snapshot.sheets.secondary;
  persist();
}

export function activatePanelView(viewId: string) {
  commit(activateShellView(state.layout, viewId));
}

export function movePanelView(viewId: string, target: PanelViewDropTarget) {
  commit(moveShellView(state.layout, viewId, target));
}

export function hidePanelView(viewId: string) {
  commit(hideShellView(state.layout, viewId));
}

export function showPanelView(viewId: string) {
  commit(showShellView(state.layout, viewId));
}

export function toggleDock(dock: DockId) {
  commit(toggleShellDock(state.layout, dock));
}

export function isPanelDockVisible(dock: DockId): boolean {
  return isDockVisible(state.layout, dock);
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;

export function resizeDock(dock: DockId, size: number) {
  const next = setShellDockSize(state.layout, dock, size);
  if (next === state.layout) return;
  state.layout = next;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(persist, RESIZE_PERSIST_DEBOUNCE_MS);
}

export function setSheetOpen(sheet: "primary" | "secondary", open: boolean) {
  shellSheets[sheet] = open;
  if (open) shellSheets[sheet === "primary" ? "secondary" : "primary"] = false;
}

export function closeSheets() {
  shellSheets.primary = false;
  shellSheets.secondary = false;
}

/**
 * Status bar toggles: desktop collapses the dock, compact opens the matching
 * drawer (left dock -> primary sheet, right/bottom docks -> secondary sheet).
 */
export function togglePanelDock(dock: DockId, compact: boolean) {
  if (!compact) {
    toggleDock(dock);
    return;
  }
  const sheet = dock === "left" ? "primary" : "secondary";
  setSheetOpen(sheet, !shellSheets[sheet]);
}

/** Ensures a view is visible and focused, opening its dock or sheet. */
export function revealPanelView(viewId: string, compact: boolean) {
  revealPanelViewWithPersistence(viewId, compact, true);
}

/** Tour-only reveal that is restored as one presentation transaction. */
export function revealPanelViewTemporarily(viewId: string, compact: boolean) {
  revealPanelViewWithPersistence(viewId, compact, false);
}

function revealPanelViewWithPersistence(
  viewId: string,
  compact: boolean,
  shouldPersist: boolean,
) {
  commit(showShellView(state.layout, viewId), shouldPersist);
  if (!compact) return;
  const dock = (["left", "right", "bottom"] as const).find((candidate) =>
    state.layout.docks[candidate].views.includes(viewId),
  );
  if (!dock) return;
  setSheetOpen(dock === "left" ? "primary" : "secondary", true);
}
