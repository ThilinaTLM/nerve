import Puzzle from "@lucide/svelte/icons/puzzle";
import {
  activateShellView,
  type DockId,
  hideShellView,
  isDockVisible,
  moveShellView,
  normalizeShellLayout,
  type PanelViewDescriptor,
  type PanelViewDropTarget,
  setShellDockSize,
  type ShellLayout,
  showShellView,
  toggleShellDock,
} from "$lib/presentation/shell";
import { panelViewDescriptors } from "$lib/app/composition/registries/panel-registry";

import {
  readShellLayoutStorage,
  SHELL_LAYOUT_STORAGE_KEY,
} from "./shell-layout-storage";
const RESIZE_PERSIST_DEBOUNCE_MS = 200;

// The bottom dock starts empty and collapsed on a fresh install; Launches lives in
// the left dock next to Conversations.
const LAYOUT_DEFAULTS = { collapsed: ["bottom"] as const };

/**
 * Extension panels are `ext:<extension-id>/<panel-id>` views that exist only while the project's
 * extensions contribute them. Hydration runs before contributions load, so ids found in the
 * stored layout stay as placeholders (nothing renders for them) until `setExtensionPanelViews`
 * settles the set.
 */
function storedExtensionViews(raw: unknown): PanelViewDescriptor[] {
  const docks = (raw as { docks?: Record<string, { views?: unknown }> } | null)
    ?.docks;
  if (!docks || typeof docks !== "object") return [];
  const ids = Object.values(docks).flatMap((dock) =>
    Array.isArray(dock?.views)
      ? dock.views.filter(
          (id): id is string => typeof id === "string" && id.startsWith("ext:"),
        )
      : [],
  );
  return ids.map((id, index) => ({
    id,
    title: id,
    icon: Puzzle,
    defaultDock: "right" as const,
    defaultOrder: 100 + index,
  }));
}

function hydrate(): ShellLayout {
  if (typeof localStorage === "undefined")
    return normalizeShellLayout(undefined, panelViewDescriptors, {
      collapsed: [...LAYOUT_DEFAULTS.collapsed],
    });
  let raw: unknown;
  try {
    raw = readShellLayoutStorage(localStorage);
  } catch {
    raw = undefined;
  }
  return normalizeShellLayout(
    raw,
    [...panelViewDescriptors, ...storedExtensionViews(raw)],
    { collapsed: [...LAYOUT_DEFAULTS.collapsed] },
  );
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
    localStorage.setItem(
      SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify(state.layout),
    );
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

/**
 * Sets the extension panels of the active project: new ones join the right dock, ones that
 * are gone leave the layout. Placement made while they exist persists with the layout.
 */
export function setExtensionPanelViews(
  views: readonly PanelViewDescriptor[],
): void {
  const next = normalizeShellLayout(
    state.layout,
    [...panelViewDescriptors, ...views],
    { collapsed: [...LAYOUT_DEFAULTS.collapsed] },
  );
  if (JSON.stringify(next) !== JSON.stringify(state.layout)) commit(next);
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

export function toggleDock(dock: DockId) {
  commit(toggleShellDock(state.layout, dock));
}

export function isPanelDockVisible(dock: DockId): boolean {
  return isDockVisible(state.layout, dock);
}

export function hasPanelDockContent(dock: DockId): boolean {
  const { views } = state.layout.docks[dock];
  return views.some((viewId) => !state.layout.hidden.includes(viewId));
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
