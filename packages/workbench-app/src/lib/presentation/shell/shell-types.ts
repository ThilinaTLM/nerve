import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import type { Component } from "svelte";

/** The three panel docks around the editor area. */
export type DockId = "left" | "right" | "bottom";

export const DOCK_IDS: readonly DockId[] = ["left", "right", "bottom"];

export const DOCK_LABELS: Record<DockId, string> = {
  left: "Left Panel",
  right: "Right Panel",
  bottom: "Bottom Panel",
};

export type PanelViewIcon = Component<{
  size?: number;
  strokeWidth?: number;
  class?: string;
  "aria-hidden"?: "true";
}>;

/** Static registration for a panel view; the registry is the authority. */
export type PanelViewDescriptor = {
  /** Stable, persisted identifier. */
  id: string;
  /** Tab label. */
  title: string;
  icon: PanelViewIcon;
  defaultDock: DockId;
  /** Ordering within the default dock. */
  defaultOrder: number;
  /** Default true; a view may be closed from its dock. */
  hideable?: boolean;
};

export type DockState = {
  /** Ordered view ids currently in this dock. */
  views: string[];
  /** Must be a member of `views`. */
  activeViewId?: string;
  /** Percent of its pane group. */
  size: number;
  collapsed: boolean;
};

export type ShellLayout = {
  version: 1;
  docks: Record<DockId, DockState>;
  /** Views explicitly closed by the user. */
  hidden: string[];
};

export type PanelViewDropTarget = {
  dock: DockId;
  index: number;
};

export type ShellActions = {
  onMoveView?: (viewId: string, target: PanelViewDropTarget) => void;
  onActivateView?: (viewId: string) => void;
  onHideView?: (viewId: string) => void;
  onToggleDock?: (dock: DockId) => void;
  onDockResize?: (dock: DockId, size: number) => void;
  onSheetOpenChange?: (sheet: "primary" | "secondary", open: boolean) => void;
};

/* ---------------------------------------------------------------------------
 * Editor area tab model (the center tabs; unrelated to panel views).
 * ------------------------------------------------------------------------- */

export type WorkbenchTabIdentity = { kind: string; id: string };

export type WorkbenchTabIcon = Component<{
  size?: number;
  strokeWidth?: number;
  class?: string;
  "aria-hidden"?: "true";
}>;

export type WorkbenchTabToggle = {
  label: string;
  title?: string;
  icon: WorkbenchTabIcon;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
};

export type WorkbenchTabStatus = {
  label?: string;
  tone?: StatusTone;
  pulse?: boolean;
};

export type WorkbenchTabModel = WorkbenchTabIdentity & {
  key?: string;
  label: string;
  title?: string;
  active?: boolean;
  running?: boolean;
  error?: boolean | string;
  closeable?: boolean;
  wide?: boolean;
  icon?: WorkbenchTabIcon;
  selectIcon?: WorkbenchTabIcon;
  status?: WorkbenchTabStatus;
  toggle?: WorkbenchTabToggle;
  draft?: boolean;
};

export type WorkbenchTabReorderHandler = (
  tab: WorkbenchTabIdentity,
  targetIndex: number,
) => void;

export type WorkbenchTabMenuBuilder = (input: {
  tab: WorkbenchTabModel;
  tabs: WorkbenchTabModel[];
  index: number;
}) => ContextMenuItem[];

export type PanelViewMenuBuilder = (input: {
  view: PanelViewDescriptor;
  dock: DockId;
  index: number;
  views: PanelViewDescriptor[];
  defaultItems: ContextMenuItem[];
}) => ContextMenuItem[];
