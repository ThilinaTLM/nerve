import type { EventEnvelope } from "$lib/api";
import { getClientConfig } from "$lib/api";
import {
  applyTheme,
  loadThemePreference,
} from "$lib/app/layout/layout-state.svelte";
import { enqueueEvent, flushEvents } from "$lib/core/events/event-bus";
import {
  clientLog,
  installClientLogging,
} from "$lib/core/logger/client-logger";
import { restoreConversationTabs } from "$lib/features/conversations/state/conversation-flow.svelte";
import {
  loadSettingsPanel,
  refreshSubscriptionUsage,
} from "$lib/features/settings/state/settings-actions.svelte";
import { composerDraft } from "$lib/features/workspace/state/selection.svelte";
import {
  loadSlashCommands,
  loadWorkspaceState,
} from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let intentionallyDisconnected = false;
let socketGeneration = 0;
let subscriptionUsagePollTimer: ReturnType<typeof setInterval> | undefined;
let livenessTimer: ReturnType<typeof setInterval> | undefined;
let lastMessageAt = 0;
const SUBSCRIPTION_USAGE_POLL_MS = 10_000;
// Force a reconnect if no frame (events or server heartbeats every ~30s) arrives
// within this window. Catches half-open sockets the browser never closes.
const LIVENESS_CHECK_MS = 15_000;
const LIVENESS_TIMEOUT_MS = 70_000;
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 5_000];

export async function initializeWorkbench(): Promise<void> {
  intentionallyDisconnected = false;
  try {
    installClientLogging();
    applyTheme(loadThemePreference());
    workspaceState.config = await retryDuringStartup(
      "load client config",
      getClientConfig,
    );
    workspaceState.status = workspaceState.config.status;
    workspaceState.error = undefined;
    composerDraft.projectDir = workspaceState.config.status.storage.home;
    await Promise.all([loadWorkspaceState(), loadSlashCommands()]);
    await restoreConversationTabs();
    await loadSettingsPanel();
    startSubscriptionUsagePolling();
    clientLog("info", "workbench", "Workbench initialized");
    connectWebsocket(workspaceState.config.wsUrl);
  } catch (caught) {
    workspaceState.error =
      caught instanceof Error ? caught.message : String(caught);
    workspaceState.connection = "error";
    clientLog("error", "workbench", "Workbench initialization failed", {
      error: caught,
    });
  }
}

async function retryDuringStartup<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (const [attempt, delayMs] of STARTUP_RETRY_DELAYS_MS.entries()) {
    try {
      return await operation();
    } catch (caught) {
      if (intentionallyDisconnected) throw caught;
      workspaceState.connection = "connecting";
      workspaceState.error = `Waiting for Nerve daemon to start (${errorMessage(caught)})`;
      clientLog("warn", "workbench", "Workbench initialization retrying", {
        context: { label, attempt: attempt + 1, delayMs },
        error: caught,
      });
      await delay(delayMs);
    }
  }
  return await operation();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveWebsocketUrl(wsUrl: string): URL {
  if (
    globalThis.location?.protocol === "http:" ||
    globalThis.location?.protocol === "https:"
  ) {
    const sameOrigin = new URL("/ws", globalThis.location.href);
    sameOrigin.protocol =
      globalThis.location.protocol === "https:" ? "wss:" : "ws:";
    return sameOrigin;
  }
  return new URL(wsUrl);
}

function clearReconnectTimer() {
  if (reconnectTimer === undefined) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function scheduleReconnect(wsUrl: string) {
  if (intentionallyDisconnected) return;
  clearReconnectTimer();
  const delay = Math.min(500 * 2 ** reconnectAttempts, 5_000);
  reconnectAttempts += 1;
  workspaceState.connection = "connecting";
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (!intentionallyDisconnected) connectWebsocket(wsUrl);
  }, delay);
}

function startLivenessWatchdog() {
  stopLivenessWatchdog();
  livenessTimer = setInterval(() => {
    if (intentionallyDisconnected) return;
    if (Date.now() - lastMessageAt < LIVENESS_TIMEOUT_MS) return;
    clientLog("warn", "websocket", "WebSocket liveness timeout; reconnecting");
    // Closing triggers the existing close handler, which schedules a reconnect.
    socket?.close();
  }, LIVENESS_CHECK_MS);
}

function stopLivenessWatchdog() {
  if (livenessTimer === undefined) return;
  clearInterval(livenessTimer);
  livenessTimer = undefined;
}

function startSubscriptionUsagePolling() {
  stopSubscriptionUsagePolling();
  subscriptionUsagePollTimer = setInterval(() => {
    void refreshSubscriptionUsage().catch(() => undefined);
  }, SUBSCRIPTION_USAGE_POLL_MS);
}

function stopSubscriptionUsagePolling() {
  if (subscriptionUsagePollTimer === undefined) return;
  clearInterval(subscriptionUsagePollTimer);
  subscriptionUsagePollTimer = undefined;
}

function dispatchIncomingEvent(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  if (event.seq && event.seq <= workspaceState.lastEventSeq) return;
  if (event.seq) workspaceState.lastEventSeq = event.seq;
  // Buffer for coalesced, frame-batched delivery (preserves arrival order).
  enqueueEvent(event);
}

function connectWebsocket(wsUrl: string) {
  clearReconnectTimer();
  const generation = socketGeneration + 1;
  socketGeneration = generation;
  socket?.close();

  const url = resolveWebsocketUrl(wsUrl);
  if (workspaceState.lastEventSeq > 0) {
    url.searchParams.set("since", String(workspaceState.lastEventSeq));
  }
  const nextSocket = new WebSocket(url);
  socket = nextSocket;
  workspaceState.connection = "connecting";

  nextSocket.addEventListener("open", () => {
    if (generation !== socketGeneration) return;
    reconnectAttempts = 0;
    workspaceState.connection = "live";
    lastMessageAt = Date.now();
    startLivenessWatchdog();
    clientLog("info", "websocket", "WebSocket connected", {
      context: { since: workspaceState.lastEventSeq },
    });
  });
  nextSocket.addEventListener("message", (message) => {
    if (generation !== socketGeneration) return;
    lastMessageAt = Date.now();
    const parsed = JSON.parse(String(message.data)) as EventEnvelope<
      Record<string, unknown>
    >;
    // Server liveness heartbeats carry no seq and must not enter the event bus.
    if (parsed.type === "heartbeat") return;
    if (parsed.type) dispatchIncomingEvent(parsed);
  });
  nextSocket.addEventListener("close", () => {
    if (generation !== socketGeneration) return;
    socket = undefined;
    if (intentionallyDisconnected) {
      workspaceState.connection = "closed";
      return;
    }
    flushEvents();
    clientLog("warn", "websocket", "WebSocket closed; reconnect scheduled");
    scheduleReconnect(wsUrl);
  });
  nextSocket.addEventListener("error", () => {
    if (generation !== socketGeneration) return;
    workspaceState.connection = "error";
    clientLog("error", "websocket", "WebSocket error");
  });
}

export function disconnectWorkbench() {
  intentionallyDisconnected = true;
  clearReconnectTimer();
  stopSubscriptionUsagePolling();
  stopLivenessWatchdog();
  socketGeneration += 1;
  socket?.close();
  socket = undefined;
  // Deliver any buffered events before tearing down.
  flushEvents();
  workspaceState.connection = "closed";
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
