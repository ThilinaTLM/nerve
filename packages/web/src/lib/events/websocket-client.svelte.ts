import type { EventEnvelope } from "../api";
import { getClientConfig } from "../api";
import {
  applyTheme,
  composerDraft,
  loadThemePreference,
} from "../state/app-state.svelte";
import { restoreConversationTabs } from "../stores/session-flow.svelte";
import { loadSettingsPanel } from "../stores/settings.svelte";
import { workbenchState } from "../stores/workbench/state.svelte";
import {
  loadSlashCommands,
  loadWorkspaceState,
} from "../stores/workspace.svelte";
import { handleEvent } from "./event-router";

let socket: WebSocket | undefined;

export async function initializeWorkbench(): Promise<void> {
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

function connectWebsocket(wsUrl: string) {
  socket?.close();
  socket = new WebSocket(new URL(wsUrl));
  socket.addEventListener("open", () => {
    workbenchState.connection = "live";
  });
  socket.addEventListener("message", (message) => {
    const parsed = JSON.parse(String(message.data)) as EventEnvelope<
      Record<string, unknown>
    >;
    if (parsed.type) handleEvent(parsed);
  });
  socket.addEventListener("close", () => {
    workbenchState.connection = "closed";
  });
  socket.addEventListener("error", () => {
    workbenchState.connection = "error";
  });
}

export function disconnectWorkbench() {
  socket?.close();
  socket = undefined;
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
