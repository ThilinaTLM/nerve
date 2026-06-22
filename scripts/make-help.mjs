const lines = [
  "Nerve shortcuts:",
  "  make dev            Build internal deps, then start daemon and web UI dev servers",
  "  make cli            Build internal deps, then run the nerve CLI in dev mode",
  "  make daemon         Build internal deps, then start the orchestrator daemon in dev mode",
  "  make serve          Build internal deps, then run nerve serve --open",
  "  make web            Build internal deps, then start the Svelte web UI dev server",
  "  make desktop        Build web/orchestrator/desktop and launch nerve-desktop on LAN (HTTP)",
  "  make desktop-mobile-https  Launch desktop with opt-in self-signed HTTPS mobile setup",
  "  make desktop-fast   Launch Electron using existing build output",
  "  make desktop-build  Build desktop dependencies and Electron main process",
  "  make desktop-check  Type-check the desktop package",
  "  make install        Install a user-space desktop launcher for this checkout",
  "  make uninstall      Remove the user-space desktop launcher",
];

console.log(lines.join("\n"));
