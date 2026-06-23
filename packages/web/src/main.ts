/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from "virtual:pwa-register";
import { mount } from "svelte";
import "./styles/app.css";
import Root from "./Root.svelte";

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
