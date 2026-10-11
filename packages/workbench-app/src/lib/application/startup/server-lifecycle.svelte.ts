import type { ServerLifecycle } from "@nervekit/contracts/status";
import {
  dismissStartupSplash,
  updateStartupSplash,
} from "$lib/app/shell/startup-splash";
import { onServerStarting } from "$lib/platform/http/server-starting-signal";
import {
  onConversationChannelReadyChange,
  isConversationChannelReady,
} from "./conversation-connection";
import {
  isWorkbenchReady,
  onWorkbenchChannelReadyChange,
} from "./workbench-connection";
import {
  LIFECYCLE_POLL_INTERVAL_MS,
  RECONNECT_OVERLAY_DELAY_MS,
  describeLifecycle,
  fetchLifecycle,
  postLifecycleRetry,
  readyAction,
  type LifecycleView,
} from "./server-lifecycle";

export const serverLifecycleState = $state({
  /** `ready` once the server has reported ready at least once. */
  phase: "booting" as "booting" | "ready" | "failed",
  lifecycle: undefined as ServerLifecycle | undefined,
  view: describeLifecycle(undefined) as LifecycleView,
  /** A retry was accepted and the server is working through it. */
  retrying: false,
  retryError: undefined as string | undefined,
  /** Post-load reconnect overlay is visible. */
  reconnecting: false,
});

let bootVersion: string | undefined;
let settling = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Settled = "boot" | "resumed" | "failed" | "reloading";

/** Polls until the server is ready or failed, mirroring progress into the UI. */
async function settle(onPending?: () => void): Promise<Settled> {
  settling = true;
  try {
    for (;;) {
      const lifecycle = await fetchLifecycle();
      if (lifecycle) serverLifecycleState.lifecycle = lifecycle;
      if (lifecycle?.state === "failed") {
        serverLifecycleState.phase = "failed";
        serverLifecycleState.retrying = false;
        dismissStartupSplash();
        return "failed";
      }
      if (lifecycle?.state === "ready") {
        serverLifecycleState.retrying = false;
        if (bootVersion === undefined) {
          bootVersion = lifecycle.version;
          serverLifecycleState.phase = "ready";
          return "boot";
        }
        if (readyAction(bootVersion, lifecycle) === "reload") {
          location.reload();
          return "reloading";
        }
        serverLifecycleState.phase = "ready";
        serverLifecycleState.reconnecting = false;
        return "resumed";
      }
      onPending?.();
      const view = describeLifecycle(lifecycle);
      serverLifecycleState.view = view;
      updateStartupSplash(view);
      await sleep(LIFECYCLE_POLL_INTERVAL_MS);
    }
  } finally {
    settling = false;
  }
}

/** Boot gate: resolves true when the server is ready and startup may run. */
export async function waitForServerReady(): Promise<boolean> {
  serverLifecycleState.phase = "booting";
  return (await settle()) === "boot";
}

/**
 * Retries a failed start. Resolves true when the caller should run the
 * initial workbench startup (the app had never loaded).
 */
export async function retryServerStart(): Promise<boolean> {
  serverLifecycleState.retryError = undefined;
  const accepted = await postLifecycleRetry();
  if (!accepted) {
    serverLifecycleState.retryError =
      "Nerve could not start another attempt. Please try again.";
    return false;
  }
  serverLifecycleState.retrying = true;
  serverLifecycleState.lifecycle = accepted;
  const wasBooting = bootVersion === undefined;
  const result = await settle();
  return wasBooting && result === "boot";
}

function beginReconnect(): void {
  if (settling || bootVersion === undefined) return;
  // The overlay only appears once the server proves not to be ready yet.
  void settle(() => {
    serverLifecycleState.reconnecting = true;
  });
}

/** Watches the protocol channels and API 503s after the app has loaded. */
export function startReconnectMonitor(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disconnected = () => {
    if (timer || settling || serverLifecycleState.phase !== "ready") return;
    timer = setTimeout(() => {
      timer = undefined;
      beginReconnect();
    }, RECONNECT_OVERLAY_DELAY_MS);
  };
  const connectedChanged = () => {
    if (isConversationChannelReady() && isWorkbenchReady()) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const stops = [
    onConversationChannelReadyChange((ready) =>
      ready ? connectedChanged() : disconnected(),
    ),
    onWorkbenchChannelReadyChange((ready) =>
      ready ? connectedChanged() : disconnected(),
    ),
    onServerStarting(disconnected),
  ];
  return () => {
    clearTimeout(timer);
    for (const stop of stops) stop();
  };
}
