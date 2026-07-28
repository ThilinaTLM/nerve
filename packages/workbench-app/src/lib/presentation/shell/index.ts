export { default as DockDropIndicator } from "./DockDropIndicator.svelte";
export { default as DockPanel } from "./DockPanel.svelte";
export { default as DockTabStrip } from "./DockTabStrip.svelte";
export { default as EditorArea } from "./EditorArea.svelte";
export { default as EditorTabStrip } from "./EditorTabStrip.svelte";
export * from "./shell-drag.svelte.js";
export * from "./shell-layout.js";
export type {
  DockId,
  DockState,
  PanelViewDescriptor,
  PanelViewDropTarget,
  PanelViewIcon,
  PanelViewMenuBuilder,
  ShellActions,
  ShellLayout,
  WorkbenchTabIcon,
  WorkbenchTabIdentity,
  WorkbenchTabMenuBuilder,
  WorkbenchTabModel,
  WorkbenchTabReorderHandler,
  WorkbenchTabStatus,
  WorkbenchTabToggle,
} from "./shell-types.js";
export { DOCK_IDS, DOCK_LABELS } from "./shell-types.js";
export type { DockToggle } from "./ShellStatusBar.svelte";
export { default as ShellStatusBar } from "./ShellStatusBar.svelte";
export { default as ShellTitlebar } from "./ShellTitlebar.svelte";
export { default as WorkbenchFrame } from "./WorkbenchFrame.svelte";
export { default as WorkbenchShell } from "./WorkbenchShell.svelte";
