/// <reference types="vite-plugin-pwa/client" />

import { mount } from "svelte";
import Root from "./Root.svelte";
import { applyZoomLevel } from "./lib/platform/appearance/appearance.svelte";
import { registerPwaServiceWorker } from "./lib/platform/pwa/register-pwa";
import "./styles/app.css";

let initialZoomLevel: string | null = null;
try {
  initialZoomLevel = window.sessionStorage.getItem("nerve.initialZoomLevel");
  window.sessionStorage.removeItem("nerve.initialZoomLevel");
} catch {
  // Storage can be unavailable in hardened browsers; server settings still win.
}
if (initialZoomLevel !== null) applyZoomLevel(Number(initialZoomLevel));

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target.");

registerPwaServiceWorker();

// The #startup-splash node from index.html stays mounted until the workbench
// reveals itself (see WorkbenchProvider), so the intro animation never restarts.
const app = mount(Root, {
  target,
});

export default app;
