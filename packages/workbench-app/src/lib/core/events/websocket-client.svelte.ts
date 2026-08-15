import { SvelteURL } from "svelte/reactivity";
import {
  browserWebSocketTransportFactory,
  createMessageFactory,
  ProtocolClientConnection,
  ProtocolClientSession,
  protocolClientId,
  protocolInstanceId,
  type ProtocolClientConnectionState,
} from "@nervekit/protocol";
import {
  parseConversationStream,
  STREAM_SUBSCRIPTION_CAPABILITY,
  type PeerDescriptor,
} from "@nervekit/contracts";
import { getClientConfig } from "$lib/api";
import {
  applyAppearance,
  loadAppearancePreference,
} from "$lib/app/shell/appearance.svelte";
import {
  applyEventAndFlush,
  enqueueNotify,
  flushNotifyEvents,
  pendingNotifyCount,
  type WorkbenchNotifyEvent,
} from "$lib/core/events/event-bus";
import {
  advanceEventCursor,
  bindSubscriptionSync,
  currentEventCursors,
  installEventCursors,
  removeEventStream,
  requestSubscriptionSync,
} from "$lib/core/events/stream-cursors.svelte";
import {
  clientLog,
  installClientLogging,
} from "$lib/core/logger/client-logger";
import { restoreConversationTabs } from "$lib/features/conversations/state/conversation-flow.svelte";
import { refreshConversationView } from "$lib/features/conversations/state/selection";
import {
  loadCoreSettings,
  reconcileComposerSelectionFromSettings,
  refreshAncillarySettingsData,
  refreshSubscriptionUsage,
} from "$lib/features/settings/state/settings-actions.svelte";
import {
  startReleasePolling,
  stopReleasePolling,
} from "$lib/features/releases";
import { composerDraft } from "$lib/features/workspace/state/selection.svelte";
import {
  loadSlashCommands,
  recoverWorkspaceSnapshotFromNetwork,
} from "$lib/features/workspace/state/workspace-actions.svelte";
import {
  workspaceState,
  type CenterTabIdentity,
} from "$lib/features/workspace/state/workspace-state.svelte";
import { selectCenterTab } from "$lib/features/workspace/state/center-tab-lifecycle.svelte";
import { runWorkbenchStartupSequence } from "$lib/core/startup/workbench-startup-sequence";
import {
  beginWorkbenchStartup,
  failWorkbenchStartup,
  isWorkbenchStartupGenerationCurrent,
  stopWorkbenchStartup,
  transitionWorkbenchStartup,
} from "$lib/core/startup/workbench-startup-state.svelte";

const PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  "snapshot.workspace",
];
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 5_000];
const SUBSCRIPTION_USAGE_POLL_MS = 10_000;
const protocolTarget: PeerDescriptor = { role: "workbench_server" };
let connection: ProtocolClientConnection | undefined;
let unbindSubscriptionSync: (() => void) | undefined;
let intentionallyDisconnected = false;
let workspaceSnapshotLoaded = false;
let subscriptionUsagePollTimer: ReturnType<typeof setInterval> | undefined;

export async function initializeWorkbench(): Promise<boolean> {
  intentionallyDisconnected = false;
  workspaceSnapshotLoaded = false;
  const generation = beginWorkbenchStartup();
  const appearance = loadAppearancePreference();
  applyAppearance(appearance.theme, appearance.colorMode);
  try {
    const diagnostics = await runWorkbenchStartupSequence({
      loadClientConfig: () =>
        retryDuringStartup("load client config", getClientConfig),
      applyClientConfig: (config) => {
        workspaceState.config = config;
        if (config.status.capabilities.applicationLogs) installClientLogging();
        workspaceState.status = config.status;
        workspaceState.error = undefined;
        composerDraft.projectDir = config.status.storage.home;
      },
      loadCoreSettings,
      recoverWorkspace: () => connectWebsocket(workspaceState.config!.wsUrl),
      restoreCriticalConversation: restoreConversationTabs,
      reconcileComposerSelection: reconcileComposerSelectionFromSettings,
      activateDeferredTab: async (desiredTab, conversationRestored) => {
        if (desiredTab && !conversationRestored)
          await selectCenterTab(desiredTab);
      },
      startProgressiveWork: () => {
        void loadSlashCommands().catch(() => undefined);
        startReleasePolling();
        refreshAncillarySettingsData();
        startSubscriptionUsagePolling();
      },
      transition: (phase) => transitionWorkbenchStartup(generation, phase),
      isCurrent: () => isWorkbenchStartupGenerationCurrent(generation),
    });
    if (!isWorkbenchStartupGenerationCurrent(generation)) return false;
    clientLog("info", "workbench", "Workbench initialized", {
      context: diagnostics,
    });
    return true;
  } catch (caught) {
    if (!isWorkbenchStartupGenerationCurrent(generation)) return false;
    failWorkbenchStartup(generation, caught);
    workspaceState.error = errorMessage(caught);
    workspaceState.connection = "error";
    clientLog("error", "workbench", "Workbench initialization failed", {
      context: { criticalBeforeProgressive: true },
      error: caught,
    });
    throw caught;
  }
}

function protocolSource(): PeerDescriptor {
  return {
    role: "ui",
    id: protocolClientId(),
    instanceId: protocolInstanceId(),
    name: "Nerve Web UI",
  };
}

async function connectWebsocket(
  wsUrl: string,
): Promise<CenterTabIdentity | undefined> {
  await connection?.close();
  unbindSubscriptionSync?.();
  const messages = createMessageFactory({
    source: protocolSource(),
    target: protocolTarget,
  });
  let resolveInitialReady!: (desiredTab: CenterTabIdentity | undefined) => void;
  let rejectInitialReady!: (error: unknown) => void;
  const initialReady = new Promise<CenterTabIdentity | undefined>(
    (resolve, reject) => {
      resolveInitialReady = resolve;
      rejectInitialReady = reject;
    },
  );

  connection = new ProtocolClientConnection({
    transport: browserWebSocketTransportFactory(resolveWebsocketUrl(wsUrl)),
    onStateChange: setConnectionState,
    onError: (error) => {
      if (!intentionallyDisconnected) {
        workspaceState.error = errorMessage(error);
        clientLog("warn", "websocket", "Protocol transport error", { error });
      }
      if (!workspaceSnapshotLoaded) rejectInitialReady(error);
    },
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities: PROTOCOL_CAPABILITIES,
        requiredCapabilities: PROTOCOL_CAPABILITIES,
        cursors: currentEventCursors,
        send,
        onDisconnect,
        onReady: async (welcome) => {
          workspaceState.protocolSessionId = welcome.sessionId;
          let desiredTab: CenterTabIdentity | undefined;
          if (!workspaceSnapshotLoaded) {
            const recovered = await recoverWorkspaceSnapshotFromNetwork({
              deferTabActivation: true,
            });
            installEventCursors(recovered.cursor.streams, {
              replace: true,
              sync: false,
            });
            desiredTab = recovered.desiredTab;
            workspaceSnapshotLoaded = true;
          }
          workspaceState.connection = "live";
          requestSubscriptionSync();
          resolveInitialReady(desiredTab);
        },
        onSnapshotRequired: async (stream) => {
          if (stream === "workspace") {
            const recovered = await recoverWorkspaceSnapshotFromNetwork();
            installEventCursors(recovered.cursor.streams, { sync: false });
            requestSubscriptionSync();
            return;
          }
          const conversationId = parseConversationStream(stream);
          if (conversationId) await refreshConversationView(conversationId);
        },
        onStreamUnavailable: (stream) => {
          // The server no longer knows this stream (conversation deleted or
          // stale). Drop its cursor so it cannot poison future subscription
          // sets; workspace events reconcile any dependent view state.
          clientLog("warn", "websocket", "Event stream unavailable", {
            context: { stream },
          });
          removeEventStream(stream);
        },
        applyEvent: async (stream, event) => {
          flushNotifyEvents();
          await applyEventAndFlush(event);
          advanceEventCursor(stream, event.seq);
        },
        onNotify: (events) => {
          for (const event of events) {
            enqueueNotify(event as WorkbenchNotifyEvent);
          }
        },
        diagnostics: {
          publish(diagnostic) {
            clientLog("warn", "websocket", "Protocol diagnostic", {
              context: {
                ...diagnostic,
                pendingNotifyEvents: pendingNotifyCount(),
              },
            });
          },
        },
      }),
  });
  unbindSubscriptionSync = bindSubscriptionSync(async (cursors) => {
    const session = connection?.session;
    if (!session || session.state !== "ready") return "skipped";
    await session.subscribe(cursors);
    return "applied";
  });
  void connection.start().catch(rejectInitialReady);
  return initialReady;
}

function setConnectionState(state: ProtocolClientConnectionState): void {
  if (state === "ready") workspaceState.connection = "live";
  else if (state === "closed" && intentionallyDisconnected)
    workspaceState.connection = "closed";
  else if (state === "closed") workspaceState.connection = "error";
  else workspaceState.connection = "connecting";
}

function resolveWebsocketUrl(wsUrl: string): URL {
  if (
    globalThis.location?.protocol === "http:" ||
    globalThis.location?.protocol === "https:"
  ) {
    const sameOrigin = new SvelteURL("/ws", globalThis.location.href);
    sameOrigin.protocol =
      globalThis.location.protocol === "https:" ? "wss:" : "ws:";
    return sameOrigin;
  }
  return new URL(wsUrl);
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return operation();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startSubscriptionUsagePolling(): void {
  stopSubscriptionUsagePolling();
  subscriptionUsagePollTimer = setInterval(
    () => void refreshSubscriptionUsage().catch(() => undefined),
    SUBSCRIPTION_USAGE_POLL_MS,
  );
}

function stopSubscriptionUsagePolling(): void {
  if (subscriptionUsagePollTimer !== undefined) {
    clearInterval(subscriptionUsagePollTimer);
  }
  subscriptionUsagePollTimer = undefined;
}

export function disconnectWorkbench(): void {
  intentionallyDisconnected = true;
  stopWorkbenchStartup();
  stopSubscriptionUsagePolling();
  stopReleasePolling();
  flushNotifyEvents();
  unbindSubscriptionSync?.();
  unbindSubscriptionSync = undefined;
  void connection?.close();
  connection = undefined;
  workspaceState.protocolSessionId = undefined;
  workspaceState.connection = "closed";
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
