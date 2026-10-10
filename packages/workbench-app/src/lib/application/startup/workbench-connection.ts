import { createMessageFactory } from "@nervekit/protocol";
import {
  ProtocolClientConnection,
  ProtocolClientSession,
} from "@nervekit/protocol/client";
import {
  browserWebSocketTransportFactory,
  protocolClientId,
  protocolInstanceId,
} from "@nervekit/protocol/adapters";
import {
  allOperationDefinitions,
  type OperationName,
  type OperationParams,
  type OperationResult,
} from "@nervekit/contracts/operations";
import { isWorkbenchOperation } from "@nervekit/contracts/events";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type ProtocolRequestData,
} from "@nervekit/contracts/wire";
import {
  beginWorkbenchRecovery,
  dispatchEvent,
  recoverWorkbenchPanels,
  type WorkbenchEvent,
} from "$lib/application/events/workbench-event-bus";

let connection: ProtocolClientConnection | undefined;
let channelReady = false;
const readyListeners = new Set<(ready: boolean) => void>();

export function onWorkbenchChannelReadyChange(
  listener: (ready: boolean) => void,
): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function notifyReadyChange(ready: boolean): void {
  if (channelReady === ready) return;
  channelReady = ready;
  for (const listener of readyListeners) listener(ready);
}

const capabilities = [
  "encoding.json",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  ...allOperationDefinitions()
    .filter((definition) => isWorkbenchOperation(definition.method))
    .map((definition) => definition.requiredCapability)
    .filter((capability): capability is string => Boolean(capability)),
];

export function isWorkbenchReady(): boolean {
  return connection?.session.state === "ready";
}

export function requestWorkbench<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  options?: Pick<
    ProtocolRequestData,
    "idempotencyKey" | "timeoutMs" | "expect"
  >,
): Promise<OperationResult<M>> {
  if (!isWorkbenchOperation(method))
    return Promise.reject(new Error(`Not a workbench operation: ${method}`));
  if (!connection || !isWorkbenchReady())
    return Promise.reject(new Error("Workbench connection is unavailable"));
  return connection.request(method, params, options);
}

export async function protocolRequest<M extends OperationName>(
  method: M,
  params: OperationParams<M>,
  options?: Pick<ProtocolRequestData, "idempotencyKey" | "timeoutMs">,
): Promise<{ result: OperationResult<M> }> {
  return { result: await requestWorkbench(method, params, options) };
}

export async function connectWorkbenchChannel(
  wsUrl: string,
  recoverMonitors: () => Promise<void>,
): Promise<void> {
  await connection?.close();
  const url = new URL(wsUrl);
  if (
    globalThis.location?.protocol === "http:" ||
    globalThis.location?.protocol === "https:"
  ) {
    url.host = globalThis.location.host;
    url.protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  }
  url.pathname = "/ws/workbench";
  const messages = createMessageFactory({
    source: {
      role: "ui",
      id: protocolClientId(),
      instanceId: protocolInstanceId(),
      name: "Nerve Workbench",
    },
    target: { role: "workbench_server" },
  });
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  connection = new ProtocolClientConnection({
    transport: browserWebSocketTransportFactory(url),
    onStateChange: (state) => {
      notifyReadyChange(state === "ready");
      if (state !== "ready") beginWorkbenchRecovery();
    },
    onError: (error) => console.warn("Workbench connection failed", error),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities,
        requiredCapabilities: ["encoding.json", "event.notify"],
        cursors: () => [],
        send,
        onDisconnect,
        onReady: () => {
          // Release welcome processing before issuing RPCs: incoming responses
          // are serialized behind this callback by ProtocolConnection.
          void (async () => {
            await recoverMonitors();
            await recoverWorkbenchPanels();
            resolve();
          })().catch((error) => {
            console.warn("Workbench snapshot recovery failed", error);
            reject(error);
            if (connection?.session.state === "ready") {
              connection.session.disconnect(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          });
        },
        applyEvent: async () => {
          throw new Error("Workbench has no durable events");
        },
        onNotify: (events) => {
          for (const event of events) dispatchEvent(event as WorkbenchEvent);
        },
      }),
  });
  void connection.start().catch(reject);
  return ready;
}

export function disconnectWorkbenchChannel(): void {
  void connection?.close();
  connection = undefined;
  notifyReadyChange(false);
  beginWorkbenchRecovery();
}
