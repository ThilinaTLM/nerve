/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from "virtual:pwa-register";
import { toast } from "svelte-sonner";
import { startPwaUpdateScheduler } from "./pwa-update-scheduler";

const UPDATE_TOAST_ID = "nerve-pwa-update";

export function registerPwaServiceWorker(): void {
  if (!shouldRegisterServiceWorker()) return;

  let stopUpdateScheduler: (() => void) | undefined;
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      toast.message("Update available", {
        id: UPDATE_TOAST_ID,
        description: "A new version of Nerve is ready.",
        duration: Infinity,
        dismissible: false,
        action: {
          label: "Reload",
          onClick: () => {
            void updateServiceWorker().catch((error: unknown) => {
              console.error("Failed to activate the Nerve update.", error);
            });
          },
        },
      });
    },
    onRegisteredSW: (_workerUrl, registration) => {
      stopUpdateScheduler?.();
      stopUpdateScheduler = registration
        ? startPwaUpdateScheduler({
            checkForUpdate: async () => {
              await registration.update();
            },
          })
        : undefined;
    },
    onRegisterError: (error: unknown) => {
      console.error("Failed to register the Nerve service worker.", error);
    },
  });
}

function shouldRegisterServiceWorker(): boolean {
  return (
    "serviceWorker" in navigator && window.nerveDesktop?.kind !== "electron"
  );
}
