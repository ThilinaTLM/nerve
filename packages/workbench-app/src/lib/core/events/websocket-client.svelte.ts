import {
  ackMessageSchema,
  createId,
  flowUpdateMessageSchema,
  heartbeatMessageSchema,
  type NerveMessage,
  nerveMessageSchema,
  type PeerDescriptor,
  protocolErrorMessageSchema,
  replayCompleteMessageSchema,
  replayRequestMessageSchema,
  replayStartedMessageSchema,
  replayUnavailableMessageSchema,
  welcomeMessageSchema,
} from "@nervekit/contracts";
import { getClientConfig } from "$lib/api";
import {
  applyTheme,
  loadThemePreference,
} from "$lib/app/layout/layout-state.svelte";
import {
  enqueueEvent,
  flushEvents,
  onEventsFlushed,
  pendingEventCount,
} from "$lib/core/events/event-bus";
import {
  clientLog,
  installClientLogging,
} from "$lib/core/logger/client-logger";
import {
  applyEventBatch,
  createClientEventStreamState,
  globalProcessedSeqFromCursor,
  markProcessed,
  resetClientEventStreamState,
} from "$lib/core/protocol/event-stream";
import { protocolClientId, protocolInstanceId } from "$lib/core/protocol/ids";
import { createClientMessage } from "$lib/core/protocol/messages";
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
let ackTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let intentionallyDisconnected = false;
let socketGeneration = 0;
let subscriptionUsagePollTimer: ReturnType<typeof setInterval> | undefined;
let livenessTimer: ReturnType<typeof setInterval> | undefined;
let unregisterFlushObserver: (() => void) | undefined;
let lastMessageAt = 0;
let sessionId: string | undefined;
let replayPending = false;
let appliedSinceAck = 0;
let duplicateSinceAck = 0;
const eventStream = createClientEventStreamState();
const SUBSCRIPTION_USAGE_POLL_MS = 10_000;
const LIVENESS_CHECK_MS = 15_000;
const LIVENESS_TIMEOUT_MS = 70_000;
const ACK_COALESCE_MS = 250;
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000, 5_000];
const PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "snapshot.workspace",
];

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
    const [snapshotCursor] = await Promise.all([
      loadWorkspaceState(),
      loadSlashCommands(),
    ]);
    workspaceState.processedEventSeq =
      globalProcessedSeqFromCursor(snapshotCursor);
    workspaceState.receivedEventSeq = Math.max(
      workspaceState.receivedEventSeq,
      workspaceState.processedEventSeq,
    );
    resetClientEventStreamState(eventStream, workspaceState.processedEventSeq);
    await restoreConversationTabs();
    await loadSettingsPanel();
    startSubscriptionUsagePolling();
    installFlushObserver();
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

function installFlushObserver(): void {
  if (unregisterFlushObserver) return;
  unregisterFlushObserver = onEventsFlushed((events) => {
    const durableSeq = events
      .filter((event) => event.durability === "durable")
      .reduce(
        (max, event) => Math.max(max, event.seq),
        workspaceState.processedEventSeq,
      );
    if (durableSeq <= workspaceState.processedEventSeq) return;
    workspaceState.processedEventSeq = durableSeq;
    markProcessed(eventStream, durableSeq);
    scheduleAck();
  });
}

function protocolSource(): PeerDescriptor {
  return {
    role: "ui",
    id: protocolClientId(),
    instanceId: protocolInstanceId(),
    name: "Nerve Web UI",
  };
}

function connectWebsocket(wsUrl: string) {
  clearReconnectTimer();
  const generation = socketGeneration + 1;
  socketGeneration = generation;
  socket?.close();
  sessionId = undefined;
  replayPending = false;
  resetClientEventStreamState(eventStream, workspaceState.processedEventSeq);

  const nextSocket = new WebSocket(resolveWebsocketUrl(wsUrl));
  socket = nextSocket;
  workspaceState.connection = "connecting";

  nextSocket.addEventListener("open", () => {
    if (generation !== socketGeneration) return;
    reconnectAttempts = 0;
    lastMessageAt = Date.now();
    startLivenessWatchdog();
    sendHello();
    clientLog("info", "websocket", "Protocol WebSocket opened", {
      context: { processedSeq: workspaceState.processedEventSeq },
    });
  });
  nextSocket.addEventListener("message", (message) => {
    if (generation !== socketGeneration) return;
    lastMessageAt = Date.now();
    handleProtocolFrame(message.data, wsUrl).catch((caught) => {
      workspaceState.connection = "error";
      clientLog("error", "websocket", "Protocol message handling failed", {
        error: caught,
      });
      nextSocket.close();
    });
  });
  nextSocket.addEventListener("close", () => {
    if (generation !== socketGeneration) return;
    socket = undefined;
    sessionId = undefined;
    if (intentionallyDisconnected) {
      workspaceState.connection = "closed";
      return;
    }
    flushEvents();
    sendAckNow();
    clientLog(
      "warn",
      "websocket",
      "Protocol WebSocket closed; reconnect scheduled",
    );
    scheduleReconnect(wsUrl);
  });
  nextSocket.addEventListener("error", () => {
    if (generation !== socketGeneration) return;
    workspaceState.connection = "error";
    clientLog("error", "websocket", "Protocol WebSocket error");
  });
}

async function handleProtocolFrame(
  data: unknown,
  wsUrl: string,
): Promise<void> {
  const raw = JSON.parse(String(data));
  const message = nerveMessageSchema.parse(raw) as NerveMessage;
  switch (message.kind) {
    case "welcome":
      await handleWelcome(message, wsUrl);
      break;
    case "heartbeat":
      heartbeatMessageSchema.parse(message);
      break;
    case "event.batch":
      handleEventBatch(message);
      break;
    case "replay.started":
      replayStartedMessageSchema.parse(message);
      replayPending = false;
      eventStream.replayBlocked = false;
      eventStream.continuitySeq = eventStream.processedSeq;
      workspaceState.protocolFlowMode = "catching_up";
      break;
    case "replay.complete":
      replayCompleteMessageSchema.parse(message);
      workspaceState.protocolFlowMode = "normal";
      break;
    case "replay.unavailable":
      replayUnavailableMessageSchema.parse(message);
      await recoverWithFreshSnapshot(wsUrl);
      break;
    case "flow.update": {
      const parsed = flowUpdateMessageSchema.parse(message);
      workspaceState.protocolFlowMode = parsed.data.mode;
      if (parsed.data.mode === "resync_required") {
        await recoverWithFreshSnapshot(wsUrl);
      }
      break;
    }
    case "error": {
      const parsed = protocolErrorMessageSchema.parse(message);
      workspaceState.error = parsed.data.message;
      clientLog("error", "websocket", "Protocol error", {
        context: { code: parsed.data.code, close: parsed.data.close },
      });
      if (parsed.data.close) socket?.close();
      break;
    }
    case "goodbye":
      socket?.close();
      break;
    default:
      clientLog("warn", "websocket", "Ignoring unknown protocol message", {
        context: { kind: message.kind },
      });
  }
}

async function handleWelcome(
  message: NerveMessage,
  wsUrl: string,
): Promise<void> {
  const parsed = welcomeMessageSchema.parse(message);
  const welcome = parsed.data;
  sessionId = welcome.sessionId;
  workspaceState.protocolSessionId = sessionId;
  if (welcome.resume.mode === "snapshot_required") {
    await recoverWithFreshSnapshot(wsUrl);
    return;
  }

  if (welcome.resume.mode === "fresh") {
    resetClientEventStreamState(eventStream, workspaceState.processedEventSeq);
  }

  workspaceState.connection = "live";
  sendReady();
}

function handleEventBatch(message: NerveMessage): void {
  const result = applyEventBatch(message.data, eventStream, enqueueEvent);
  workspaceState.receivedEventSeq = result.highestReceivedSeq;
  appliedSinceAck += result.durableEventsQueued;
  duplicateSinceAck += result.duplicateEvents;
  if (result.replayRequired && !replayPending) {
    replayPending = true;
    sendReplayRequest(result.replayRequired.fromSeq);
  }
}

async function recoverWithFreshSnapshot(wsUrl: string): Promise<void> {
  clientLog(
    "warn",
    "websocket",
    "Protocol resync requested; reloading workspace",
  );
  const cursor = await loadWorkspaceState().catch((caught) => {
    workspaceState.error = errorMessage(caught);
    return undefined;
  });
  if (cursor) {
    workspaceState.processedEventSeq = globalProcessedSeqFromCursor(cursor);
    workspaceState.receivedEventSeq = Math.max(
      workspaceState.receivedEventSeq,
      workspaceState.processedEventSeq,
    );
    resetClientEventStreamState(eventStream, workspaceState.processedEventSeq);
  }
  socket?.close();
  scheduleReconnect(wsUrl);
}

function sendHello(): void {
  const resume =
    workspaceState.processedEventSeq > 0
      ? {
          streams: [
            {
              stream: "global",
              processedSeq: workspaceState.processedEventSeq,
            },
          ],
        }
      : undefined;
  sendMessage(
    createClientMessage(
      "hello",
      {
        role: "ui",
        client: {
          id: protocolClientId(),
          instanceId: protocolInstanceId(),
          name: "Nerve Web UI",
          platform: "browser",
          userAgent: globalThis.navigator?.userAgent,
        },
        requestedVersion: 1,
        capabilities: PROTOCOL_CAPABILITIES,
        encodings: ["json"],
        resume,
        preferences: {
          batch: { maxEvents: 500, maxBytes: 1_048_576, maxDelayMs: 16 },
          heartbeatIntervalMs: 30_000,
          replay: { preferSnapshot: false, maxReplayEvents: 10_000 },
        },
      },
      protocolSource(),
    ),
  );
}

function sendReady(): void {
  if (!sessionId) return;
  sendMessage(
    createClientMessage(
      "ready",
      {
        sessionId,
        streams: [
          { stream: "global", processedSeq: workspaceState.processedEventSeq },
        ],
      },
      protocolSource(),
    ),
  );
}

function sendReplayRequest(fromSeq: number): void {
  if (!sessionId) return;
  const message = createClientMessage(
    "replay.request",
    {
      sessionId,
      replayId: createId("rpl"),
      streams: [{ stream: "global", fromSeq }],
      reason: "gap_detected",
      preferences: {
        maxEvents: 10_000,
        maxBytes: 4_194_304,
        preferSnapshot: false,
        includeTransientIfAvailable: true,
      },
    },
    protocolSource(),
  );
  sendMessage(replayRequestMessageSchema.parse(message));
}

function scheduleAck(): void {
  if (ackTimer !== undefined) return;
  ackTimer = setTimeout(() => {
    ackTimer = undefined;
    sendAckNow();
  }, ACK_COALESCE_MS);
}

function sendAckNow(): void {
  if (ackTimer !== undefined) {
    clearTimeout(ackTimer);
    ackTimer = undefined;
  }
  if (!sessionId || !socket || socket.readyState !== WebSocket.OPEN) return;
  const message = createClientMessage(
    "ack",
    {
      sessionId,
      ackId: createId("ack"),
      streams: [
        { stream: "global", processedSeq: workspaceState.processedEventSeq },
      ],
      received: [
        { stream: "global", highestSeq: workspaceState.receivedEventSeq },
      ],
      stats: {
        appliedEvents: appliedSinceAck,
        duplicateEvents: duplicateSinceAck,
        pendingEvents: pendingEventCount(),
      },
    },
    protocolSource(),
  );
  appliedSinceAck = 0;
  duplicateSinceAck = 0;
  sendMessage(ackMessageSchema.parse(message));
}

function sendMessage(message: NerveMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export function disconnectWorkbench() {
  intentionallyDisconnected = true;
  clearReconnectTimer();
  stopSubscriptionUsagePolling();
  stopLivenessWatchdog();
  socketGeneration += 1;
  flushEvents();
  sendAckNow();
  if (sessionId) {
    sendMessage(
      createClientMessage(
        "goodbye",
        {
          sessionId,
          reason: "client_closing",
          finalCursors: [
            {
              stream: "global",
              processedSeq: workspaceState.processedEventSeq,
            },
          ],
        },
        protocolSource(),
      ),
    );
  }
  socket?.close();
  socket = undefined;
  sessionId = undefined;
  unregisterFlushObserver?.();
  unregisterFlushObserver = undefined;
  workspaceState.connection = "closed";
}

export { disconnectWorkbench as disconnect, initializeWorkbench as connect };
