import {
  DOCK_IDS,
  type DockId,
  type DockState,
  type PanelViewDescriptor,
  type PanelViewDropTarget,
  type ShellLayout,
} from "./shell-types.js";

export const SHELL_LAYOUT_VERSION = 1;

/** Pane size limits (percent of the owning pane group). */
export const DOCK_SIZE_LIMITS: Record<DockId, { min: number; max: number }> = {
  left: { min: 14, max: 34 },
  right: { min: 16, max: 40 },
  bottom: { min: 12, max: 70 },
};

export const DEFAULT_DOCK_SIZES: Record<DockId, number> = {
  left: 19,
  right: 24,
  bottom: 30,
};

export type ShellLayoutDefaults = {
  sizes?: Partial<Record<DockId, number>>;
  /** Docks that start collapsed on a fresh install. */
  collapsed?: readonly DockId[];
};

function clampSize(dock: DockId, size: unknown): number {
  const limits = DOCK_SIZE_LIMITS[dock];
  if (typeof size !== "number" || !Number.isFinite(size))
    return DEFAULT_DOCK_SIZES[dock];
  return Math.min(limits.max, Math.max(limits.min, size));
}

function isDockId(value: unknown): value is DockId {
  return DOCK_IDS.includes(value as DockId);
}

function cloneLayout(layout: ShellLayout): ShellLayout {
  return {
    version: SHELL_LAYOUT_VERSION,
    docks: {
      left: { ...layout.docks.left, views: [...layout.docks.left.views] },
      right: { ...layout.docks.right, views: [...layout.docks.right.views] },
      bottom: { ...layout.docks.bottom, views: [...layout.docks.bottom.views] },
    },
    hidden: [...layout.hidden],
  };
}

/** A dock with no visible views is always collapsed. */
function repairDock(
  dock: DockId,
  state: DockState,
  hidden: readonly string[],
): DockState {
  const visible = state.views.filter((id) => !hidden.includes(id));
  const activeViewId =
    state.activeViewId && visible.includes(state.activeViewId)
      ? state.activeViewId
      : visible[0];
  return {
    views: state.views,
    activeViewId,
    size: clampSize(dock, state.size),
    collapsed: visible.length === 0 ? true : state.collapsed,
  };
}

function repairLayout(layout: ShellLayout): ShellLayout {
  const next = cloneLayout(layout);
  for (const dock of DOCK_IDS) {
    next.docks[dock] = repairDock(dock, next.docks[dock], next.hidden);
  }
  return next;
}

export function defaultShellLayout(
  descriptors: readonly PanelViewDescriptor[],
  defaults: ShellLayoutDefaults = {},
): ShellLayout {
  const docks = {} as Record<DockId, DockState>;
  for (const dock of DOCK_IDS) {
    const views = descriptors
      .filter((descriptor) => descriptor.defaultDock === dock)
      .sort((a, b) => a.defaultOrder - b.defaultOrder)
      .map((descriptor) => descriptor.id);
    docks[dock] = {
      views,
      activeViewId: views[0],
      size: clampSize(dock, defaults.sizes?.[dock] ?? DEFAULT_DOCK_SIZES[dock]),
      collapsed: defaults.collapsed?.includes(dock) ?? false,
    };
  }
  return repairLayout({ version: SHELL_LAYOUT_VERSION, docks, hidden: [] });
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Single hydration entry point: tolerates any input, drops unknown view ids,
 * appends newly registered descriptors to their default dock, and repairs
 * active views, sizes, and collapse state.
 */
export function normalizeShellLayout(
  raw: unknown,
  descriptors: readonly PanelViewDescriptor[],
  defaults: ShellLayoutDefaults = {},
): ShellLayout {
  const fallback = defaultShellLayout(descriptors, defaults);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

  const source = raw as Partial<ShellLayout>;
  const rawDocks =
    source.docks && typeof source.docks === "object" ? source.docks : undefined;
  if (!rawDocks) return fallback;

  const known = new Set(descriptors.map((descriptor) => descriptor.id));
  const seen = new Set<string>();
  const docks = {} as Record<DockId, DockState>;

  for (const dock of DOCK_IDS) {
    const rawDock = (rawDocks as Record<string, unknown>)[dock];
    const dockSource =
      rawDock && typeof rawDock === "object"
        ? (rawDock as Partial<DockState>)
        : {};
    const views = readStringArray(dockSource.views).filter((id) => {
      if (!known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    docks[dock] = {
      views,
      activeViewId:
        typeof dockSource.activeViewId === "string"
          ? dockSource.activeViewId
          : undefined,
      size: clampSize(dock, dockSource.size ?? fallback.docks[dock].size),
      collapsed: dockSource.collapsed === true,
    };
  }

  // Newly registered descriptors join their default dock in registry order.
  for (const descriptor of [...descriptors].sort(
    (a, b) => a.defaultOrder - b.defaultOrder,
  )) {
    if (seen.has(descriptor.id)) continue;
    seen.add(descriptor.id);
    docks[descriptor.defaultDock].views.push(descriptor.id);
  }

  const hidden = readStringArray(source.hidden).filter((id) => known.has(id));

  return repairLayout({
    version: SHELL_LAYOUT_VERSION,
    docks,
    hidden: [...new Set(hidden)],
  });
}

export function findViewDock(
  layout: ShellLayout,
  viewId: string,
): DockId | undefined {
  return DOCK_IDS.find((dock) => layout.docks[dock].views.includes(viewId));
}

export function moveShellView(
  layout: ShellLayout,
  viewId: string,
  target: PanelViewDropTarget,
): ShellLayout {
  if (!isDockId(target.dock)) return layout;
  const source = findViewDock(layout, viewId);
  if (!source) return layout;

  const next = cloneLayout(layout);
  const from = next.docks[source];
  const currentIndex = from.views.indexOf(viewId);
  from.views.splice(currentIndex, 1);

  const to = next.docks[target.dock];
  const insertAt = Math.min(Math.max(target.index, 0), to.views.length);
  to.views.splice(insertAt, 0, viewId);

  next.hidden = next.hidden.filter((id) => id !== viewId);
  to.activeViewId = viewId;
  to.collapsed = false;
  return repairLayout(next);
}

export function activateShellView(
  layout: ShellLayout,
  viewId: string,
): ShellLayout {
  const dock = findViewDock(layout, viewId);
  if (!dock) return layout;
  const next = cloneLayout(layout);
  next.hidden = next.hidden.filter((id) => id !== viewId);
  next.docks[dock].activeViewId = viewId;
  next.docks[dock].collapsed = false;
  return repairLayout(next);
}

export function hideShellView(
  layout: ShellLayout,
  viewId: string,
): ShellLayout {
  if (!findViewDock(layout, viewId)) return layout;
  if (layout.hidden.includes(viewId)) return layout;
  const next = cloneLayout(layout);
  next.hidden.push(viewId);
  return repairLayout(next);
}

export function showShellView(
  layout: ShellLayout,
  viewId: string,
): ShellLayout {
  const dock = findViewDock(layout, viewId);
  if (!dock) return layout;
  const next = cloneLayout(layout);
  next.hidden = next.hidden.filter((id) => id !== viewId);
  next.docks[dock].activeViewId = viewId;
  next.docks[dock].collapsed = false;
  return repairLayout(next);
}

export function toggleShellDock(
  layout: ShellLayout,
  dock: DockId,
): ShellLayout {
  const next = cloneLayout(layout);
  next.docks[dock].collapsed = !next.docks[dock].collapsed;
  return repairLayout(next);
}

export function setShellDockSize(
  layout: ShellLayout,
  dock: DockId,
  size: number,
): ShellLayout {
  const clamped = clampSize(dock, size);
  if (layout.docks[dock].size === clamped) return layout;
  const next = cloneLayout(layout);
  next.docks[dock].size = clamped;
  return next;
}

/** Visible descriptors of a dock, in dock order. */
export function dockDescriptors(
  layout: ShellLayout,
  dock: DockId,
  descriptors: readonly PanelViewDescriptor[],
): PanelViewDescriptor[] {
  const byId = new Map(descriptors.map((item) => [item.id, item]));
  return layout.docks[dock].views
    .filter((id) => !layout.hidden.includes(id))
    .map((id) => byId.get(id))
    .filter((item): item is PanelViewDescriptor => item !== undefined);
}

/** True when the dock has at least one visible view and is not collapsed. */
export function isDockVisible(layout: ShellLayout, dock: DockId): boolean {
  if (layout.docks[dock].collapsed) return false;
  return layout.docks[dock].views.some((id) => !layout.hidden.includes(id));
}
