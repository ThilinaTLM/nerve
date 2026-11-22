// Not frame-safe (a dropdown draws outside the pane); extension frames use the
// SDK's `FloatingToolbarMenu`, which opens `host.ui.showMenu`.
export { default as FloatingToolbarMenu } from "./floating-toolbar-menu.svelte";
