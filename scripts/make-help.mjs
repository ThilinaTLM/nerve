const lines = [
  "Nerve shortcuts:",
  "  make dev            Build internal deps, then start daemon and web UI dev servers",
  "  make daemon         Build internal deps, then start the orchestrator daemon in dev mode",
  "  make web            Build internal deps, then start the Svelte web UI dev server",
  "  make desktop        Build web/orchestrator/desktop and launch Electron",
  "  make desktop-fast   Launch Electron using existing build output",
  "  make desktop-build  Build desktop dependencies and Electron main process",
  "  make desktop-check  Type-check the desktop package",
  "  make install        Install a user-space desktop launcher for this checkout",
  "  make uninstall      Remove the user-space desktop launcher",
];

console.log(lines.join("\n"));
