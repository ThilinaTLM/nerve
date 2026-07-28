/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from "virtual:pwa-register";
import { mount } from "svelte";
import Root from "./Root.svelte";
import { applyZoomLevel } from "./lib/app/shell/appearance.svelte";
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

if (shouldRegisterServiceWorker()) {
  registerSW({ immediate: true });
}

const app = mount(Root, {
  target,
});

function shouldRegisterServiceWorker(): boolean {
  return (
    "serviceWorker" in navigator && window.nerveDesktop?.kind !== "electron"
  );
}

export default app;
