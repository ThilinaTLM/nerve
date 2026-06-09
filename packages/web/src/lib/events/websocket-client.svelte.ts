import type { EventEnvelope } from "../api";
import { getClientConfig } from "../api";
import { clientLog, installClientLogging } from "../logging/client-logger";
import {
  applyTheme,
  composerDraft,
  loadThemePreference,
} from "../state/app-state.svelte";
import { restoreConversationTabs } from "../stores/conversation-flow.svelte";
import {
  loadSettingsPanel,
  refreshSubscriptionUsage,
} from "../stores/settings.svelte";
import { workbenchState } from "../stores/workbench/state.svelte";
import {
  loadSlashCommands,
  loadWorkspaceState,
} from "../stores/workspace.svelte";
import { handleEvent } from "./event-router";

let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let intentionallyDisconnected = false;
let socketGeneration = 0;
let subscriptionUsagePollTimer: ReturnType<typeof setInterval> | undefined;
const SUBSCRIPTION_USAGE_POLL_MS = 10_000;
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 5_000];

export async function initializeWorkbench(): Promise<void> {
  intentionallyDisconnected = false;
  try {
    installClientLogging();
    applyTheme(loadThemePreference());
    workbenchState.config = await retryDuringStartup(
      "load client config",
      getClientConfig,
    );
    workbenchState.status = workbenchState.config.status;
    workbenchState.error = undefined;
    composerDraft.projectDir = workbenchState.config.status.storage.home;
    await Promise.all([loadWorkspaceState(), loadSlashCommands()]);
    await restoreConversationTabs();
    await loadSettingsPanel();
    startSubscriptionUsagePolling();
    clientLog("info", "workbench", "Workbench initialized");
    connectWebsocket(workbenchState.config.wsUrl);
  } catch (caught) {
    workbenchState.error =
      caught instanceof Error ? caught.message : String(caught);
    workbenchState.connection = "error";
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
      workbenchState.connection = "connecting";
      workbenchState.error = `Waiting for Nerve daemon to start (${errorMessage(caught)})`;
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
  workbenchState.connection = "connecting";
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (!intentionallyDisconnected) connectWebsocket(wsUrl);
  }, delay);
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

function connectWebsocket(wsUrl: string) {
  clearReconnectTimer();
  const generation = socketGeneration + 1;
  socketGeneration = generation;
  socket?.close();

  const url = resolveWebsocketUrl(wsUrl);
  if (workbenchState.lastEventSeq > 0) {
    url.searchParams.set("since", String(workbenchState.lastEventSeq));
  }
  const nextSocket = new WebSocket(url);
  socket = nextSocket;
  workbenchState.connection = "connecting";

  nextSocket.addEventListener("open", () => {
    if (generation !== socketGeneration) return;
    reconnectAttempts = 0;
    workbenchState.connection = "live";
    clientLog("info", "websocket", "WebSocket connected", {
      context: { since: workbenchState.lastEventSeq },
    });
  });
  nextSocket.addEventListener("message", (message) => {
    if (generation !== socketGeneration) return;
    const parsed = JSON.parse(String(message.data)) as EventEnvelope<
      Record<string, unknown>
    >;
    if (parsed.type) handleEvent(parsed);
  });
  nextSocket.addEventListener("close", () => {
    if (generation !== socketGeneration) return;
    socket = undefined;
    if (intentionallyDisconnected) {
      workbenchState.connection = "closed";
      return;
    }
    clientLog("warn", "websocket", "WebSocket closed; reconnect scheduled");
    scheduleReconnect(wsUrl);
  });
  nextSocket.addEventListener("error", () => {
    if (generation !== socketGeneration) return;
    workbenchState.connection = "error";
    clientLog("error", "websocket", "WebSocket error");
  });
}

export function disconnectWorkbench() {
  intentionallyDisconnected = true;
  clearReconnectTimer();
  stopSubscriptionUsagePolling();
  socketGeneration += 1;
  socket?.close();
  socket = undefined;
  workbenchState.connection = "closed";
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
