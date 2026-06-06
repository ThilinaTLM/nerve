import type { EventEnvelope } from "../api";
import { getClientConfig } from "../api";
import {
  applyTheme,
  composerDraft,
  loadThemePreference,
} from "../state/app-state.svelte";
import { restoreConversationTabs } from "../stores/conversation-flow.svelte";
import { loadSettingsPanel } from "../stores/settings.svelte";
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

export async function initializeWorkbench(): Promise<void> {
  intentionallyDisconnected = false;
  try {
    applyTheme(loadThemePreference());
    workbenchState.config = await getClientConfig();
    workbenchState.status = workbenchState.config.status;
    composerDraft.projectDir = workbenchState.config.status.storage.home;
    await Promise.all([loadWorkspaceState(), loadSlashCommands()]);
    await restoreConversationTabs();
    await loadSettingsPanel();
    connectWebsocket(workbenchState.config.wsUrl);
  } catch (caught) {
    workbenchState.error =
      caught instanceof Error ? caught.message : String(caught);
    workbenchState.connection = "error";
  }
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
    scheduleReconnect(wsUrl);
  });
  nextSocket.addEventListener("error", () => {
    if (generation !== socketGeneration) return;
    workbenchState.connection = "error";
  });
}

export function disconnectWorkbench() {
  intentionallyDisconnected = true;
  clearReconnectTimer();
  socketGeneration += 1;
  socket?.close();
  socket = undefined;
  workbenchState.connection = "closed";
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
