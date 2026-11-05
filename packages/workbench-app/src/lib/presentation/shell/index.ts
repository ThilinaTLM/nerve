export { default as EditorArea } from "./EditorArea.svelte";
export { default as EditorTabStrip } from "./EditorTabStrip.svelte";
export * from "./mobile/index.js";
export * from "./shell-drag.svelte.js";
export * from "./shell-layout.js";
export * from "./status-bar-chip.js";
export type {
  DockId,
  PanelViewDescriptor,
  PanelViewDropTarget,
  ShellLayout,
  WorkbenchTabIdentity,
  WorkbenchTabModel,
} from "./shell-types.js";
export { DOCK_IDS, DOCK_LABELS } from "./shell-types.js";
export type { DockToggle } from "./ShellStatusBar.svelte";
export { default as ShellStatusBar } from "./ShellStatusBar.svelte";
export { default as ShellTitlebar } from "./ShellTitlebar.svelte";
export { default as WorkbenchShell } from "./WorkbenchShell.svelte";
