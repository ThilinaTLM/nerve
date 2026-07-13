import { SvelteURL } from "svelte/reactivity";
import {
  createMessageFactory,
  browserWebSocketTransportFactory,
  ProtocolClientConnection,
  ProtocolClientSession,
  protocolClientId,
  protocolInstanceId,
  type ProtocolClientConnectionState,
} from "@nervekit/protocol";
import type { PeerDescriptor, StreamCursor } from "@nervekit/contracts";
import { getClientConfig } from "$lib/api";
import {
  applyTheme,
  loadThemePreference,
} from "$lib/app/layout/layout-state.svelte";
import {
  applyEventAndFlush,
  enqueueEvent,
  flushEvents,
  pendingEventCount,
} from "$lib/core/events/event-bus";
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
  recoverWorkspaceSnapshotFromNetwork,
} from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

const PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "snapshot.workspace",
];
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 5_000];
const SUBSCRIPTION_USAGE_POLL_MS = 10_000;
const protocolTarget: PeerDescriptor = { role: "workbench_server" };
let connection: ProtocolClientConnection | undefined;
let intentionallyDisconnected = false;
let subscriptionUsagePollTimer: ReturnType<typeof setInterval> | undefined;

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
    const [cursor] = await Promise.all([
      loadWorkspaceState(),
      loadSlashCommands(),
    ]);
    installCursors(cursor.streams);
    await restoreConversationTabs();
    await loadSettingsPanel();
    startSubscriptionUsagePolling();
    connectWebsocket(workspaceState.config.wsUrl);
    clientLog("info", "workbench", "Workbench initialized");
  } catch (caught) {
    workspaceState.error = errorMessage(caught);
    workspaceState.connection = "error";
    clientLog("error", "workbench", "Workbench initialization failed", {
      error: caught,
    });
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

function connectWebsocket(wsUrl: string): void {
  void connection?.close();
  const messages = createMessageFactory({
    source: protocolSource(),
    target: protocolTarget,
  });
  connection = new ProtocolClientConnection({
    transport: browserWebSocketTransportFactory(resolveWebsocketUrl(wsUrl)),
    onStateChange: setConnectionState,
    onError: (error) => {
      if (!intentionallyDisconnected) {
        workspaceState.error = errorMessage(error);
        clientLog("warn", "websocket", "Protocol transport error", { error });
      }
    },
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities: PROTOCOL_CAPABILITIES,
        requiredCapabilities: PROTOCOL_CAPABILITIES,
        cursors: currentCursors,
        send,
        onDisconnect,
        onReady: (welcome) => {
          workspaceState.protocolSessionId = welcome.sessionId;
          workspaceState.connection = "live";
        },
        onFlowUpdate: (message) => {
          if (message.kind === "flow.update")
            workspaceState.protocolFlowMode = message.data.mode;
        },
        applyEvent: async (_stream, event) => {
          if (event.durability === "durable") {
            // Preserve FIFO order: apply all buffered transient events first,
            // then apply the durable event and wait for every reducer so the
            // session's processed-cursor ack reflects real application.
            flushEvents();
            await applyEventAndFlush(event);
            workspaceState.processedEventSeq = Math.max(
              workspaceState.processedEventSeq,
              event.seq,
            );
          } else {
            // High-frequency transient events (live deltas) coalesce per frame.
            enqueueEvent(event);
          }
          workspaceState.receivedEventSeq = Math.max(
            workspaceState.receivedEventSeq,
            event.seq,
          );
        },
        processedEvents: {
          persist(cursors) {
            installCursors(cursors);
          },
        },
        snapshotRecovery: {
          async load() {
            // loadWorkspaceState applies the complete snapshot before returning its cursor.
            const cursor = await recoverWorkspaceSnapshotFromNetwork();
            return { snapshot: undefined, cursors: cursor.streams };
          },
        },
        installSnapshot: () => undefined,
        diagnostics: {
          publish(diagnostic) {
            clientLog("warn", "websocket", "Protocol diagnostic", {
              context: { ...diagnostic, pendingEvents: pendingEventCount() },
            });
          },
        },
      }),
  });
  void connection.start();
}

function currentCursors(): readonly StreamCursor[] {
  return [{ stream: "local", processedSeq: workspaceState.processedEventSeq }];
}

function installCursors(cursors: readonly StreamCursor[]): void {
  const local = cursors.find((cursor) => cursor.stream === "local");
  if (!local) return;
  workspaceState.processedEventSeq = local.processedSeq;
  workspaceState.receivedEventSeq = local.processedSeq;
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
  if (subscriptionUsagePollTimer !== undefined)
    clearInterval(subscriptionUsagePollTimer);
  subscriptionUsagePollTimer = undefined;
}

export function disconnectWorkbench(): void {
  intentionallyDisconnected = true;
  stopSubscriptionUsagePolling();
  // Apply any buffered transient events deterministically before teardown.
  flushEvents();
  void connection?.close();
  connection = undefined;
  workspaceState.protocolSessionId = undefined;
  workspaceState.connection = "closed";
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
