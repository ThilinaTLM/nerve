/// <reference types="vite-plugin-pwa/client" />

import { mount } from "svelte";
import Root from "./Root.svelte";
import { applyZoomLevel } from "./lib/app/shell/appearance.svelte";
import { registerPwaServiceWorker } from "./lib/core/pwa/register-pwa";
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

const startupBootstrap = document.getElementById("startup-bootstrap");
const app = mount(Root, {
  target,
});
startupBootstrap?.remove();

export default app;
