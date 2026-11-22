// Floating chrome of panes and tab pages. Frame-safe: nothing here draws
// outside the pane (the menu lives in `floating-toolbar-menu`).
export { default as FloatingLayer } from "./floating-layer.svelte";
export { default as FloatingToolbar } from "./floating-toolbar.svelte";
export { default as FloatingToolbarGroup } from "./floating-toolbar-group.svelte";
export { default as FloatingToolbarButton } from "./floating-toolbar-button.svelte";
export { default as FloatingToolbarText } from "./floating-toolbar-text.svelte";
export { default as FloatingPanel } from "./floating-panel.svelte";
export { default as FloatingNotice } from "./floating-notice.svelte";
export { rowIn, rowOut } from "./floating-motion.js";
