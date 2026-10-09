import {
  connectWorkbenchChannel,
  disconnectWorkbenchChannel,
} from "./workbench-connection";
import {
  connectConversationChannel,
  disconnectConversationChannel,
  observeConversationChannel,
} from "./conversation-connection";
import { getClientConfig } from "$lib/api";
import {
  applyAppearance,
  loadAppearancePreference,
} from "$lib/platform/appearance/appearance.svelte";
import { installClientLogging } from "$lib/platform/logging/client-logger";
import {
  loadCoreSettings,
  refreshAncillarySettingsData,
  refreshSubscriptionUsage,
} from "$lib/application/settings";
import {
  startReleasePolling,
  stopReleasePolling,
} from "$lib/features/releases";
import { loadWorkspaceState } from "$lib/application/workspace/workspace-actions.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { closeCenterTabs } from "$lib/application/workspace/center-tab-actions.svelte";
import { removeTabsFromAllSessions } from "$lib/application/workspace/workspace-tab-sessions";
import {
  beginWorkbenchStartup,
  failWorkbenchStartup,
  stopWorkbenchStartup,
  transitionWorkbenchStartup,
} from "./workbench-startup-state.svelte";
import { workspaceMonitorDemand } from "$lib/application/monitoring/workspace-monitor-demand";
let usageTimer: ReturnType<typeof setInterval> | undefined;
let unobserve: (() => void) | undefined;

export async function initializeWorkbench(): Promise<boolean> {
  const generation = beginWorkbenchStartup();
  transitionWorkbenchStartup(generation, "critical");
  const appearance = loadAppearancePreference();
  applyAppearance(appearance.theme, appearance.colorMode);
  try {
    const config = await getClientConfig();
    workspaceState.config = config;
    workspaceState.status = config.status;
    if (config.status.capabilities.applicationLogs) installClientLogging();
    // Workbench panel recovery reads core projects through the conversation channel.
    await connectConversationChannel(config.wsUrl);
    await connectWorkbenchChannel(config.wsUrl, () =>
      workspaceMonitorDemand.reconcile(),
    );
    unobserve?.();
    unobserve = observeConversationChannel({
      recover: async (id) => {
        if (!id) await loadWorkspaceState();
        workspaceState.connection = "connected";
      },
      disconnected: () => {
        workspaceState.connection = "reconnecting";
      },
      event: () => undefined,
      notice: (notice) => {
        if (notice.type === "conversation.changed") {
          const summary = notice.data.summary;
          workspaceState.conversations = [
            ...workspaceState.conversations.filter(
              (row) => row.id !== summary.id,
            ),
            summary,
          ];
        } else if (notice.type === "conversation.deleted") {
          const id = notice.data.conversationId;
          workspaceState.conversations = workspaceState.conversations.filter(
            (row) => row.id !== id,
          );
          removeTabsFromAllSessions(
            (tab) => tab.kind === "conversation" && tab.id === id,
          );
          void closeCenterTabs([{ kind: "conversation", id }]);
        }
      },
    });
    await loadCoreSettings();
    await loadWorkspaceState();
    workspaceState.connection = "connected";
    workspaceState.error = undefined;
    transitionWorkbenchStartup(generation, "core-ready");
    transitionWorkbenchStartup(generation, "progressive");
    startReleasePolling();
    refreshAncillarySettingsData();
    usageTimer = setInterval(
      () => void refreshSubscriptionUsage().catch(() => undefined),
      10_000,
    );
    return true;
  } catch (error) {
    failWorkbenchStartup(generation, error);
    workspaceState.connection = "error";
    workspaceState.error =
      error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export function disconnectWorkbench(): void {
  stopWorkbenchStartup();
  if (usageTimer) clearInterval(usageTimer);
  usageTimer = undefined;
  unobserve?.();
  unobserve = undefined;
  stopReleasePolling();
  workspaceMonitorDemand.reset();
  disconnectWorkbenchChannel();
  disconnectConversationChannel();
  workspaceState.connection = "closed";
}
export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
