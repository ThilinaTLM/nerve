import {
  conversationChannelOperations,
  conversationChannelEventSchemas,
  conversationEventSchema,
  type ConversationEvent,
} from "@nervekit/contracts/core";
import type {
  OperationParams,
  OperationResult,
} from "@nervekit/contracts/operations";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type StreamCursor,
} from "@nervekit/contracts/wire";
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

type NoticeName = Exclude<
  keyof typeof conversationChannelEventSchemas,
  "conversation.event"
>;
export type ConversationNotice = {
  [K in NoticeName]: {
    type: K;
    data: ReturnType<(typeof conversationChannelEventSchemas)[K]["parse"]>;
  };
}[NoticeName];
export type ConversationOperation =
  (typeof conversationChannelOperations)[number]["method"];

export interface ConversationChannelObserver {
  recover(conversationId?: string): Promise<void>;
  disconnected(): void;
  event(event: ConversationEvent): void;
  notice(notice: ConversationNotice): void;
  unavailable?(conversationId: string): void;
}

let connection: ProtocolClientConnection | undefined;
let channelReady = false;
const readyListeners = new Set<(ready: boolean) => void>();

export function onConversationChannelReadyChange(
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

const observers = new Set<ConversationChannelObserver>();
const cursors = new Map<string, number>();
let recovery: Promise<void> | undefined;
let subscriptionSync: Promise<void> = Promise.resolve();
const capabilities = [
  "encoding.json",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  ...conversationChannelOperations.map(
    (operation) => operation.requiredCapability,
  ),
].filter((capability): capability is string => Boolean(capability));

export function observeConversationChannel(
  observer: ConversationChannelObserver,
): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

export function isConversationChannelReady(): boolean {
  return connection?.session.state === "ready";
}

export function requestConversation<M extends ConversationOperation>(
  method: M,
  params: OperationParams<M>,
): Promise<OperationResult<M>> {
  if (!connection || !isConversationChannelReady())
    return Promise.reject(new Error("Conversation connection is unavailable"));
  return connection.request(method, params);
}

function currentCursors(): StreamCursor[] {
  return [...cursors].map(([conversationId, processedSeq]) => ({
    stream: `conv/${conversationId}`,
    processedSeq,
  }));
}

export function conversationReplaySequence(conversationId: string): number {
  return cursors.get(conversationId) ?? 0;
}

export function installConversationReplaySequence(
  conversationId: string,
  sequence: number,
): void {
  cursors.set(
    conversationId,
    Math.max(cursors.get(conversationId) ?? 0, sequence),
  );
}

export function subscribeConversation(conversationId: string): Promise<void> {
  if (!cursors.has(conversationId)) cursors.set(conversationId, 0);
  return syncSubscriptions();
}

export function unsubscribeConversation(conversationId: string): Promise<void> {
  cursors.delete(conversationId);
  return syncSubscriptions();
}

function syncSubscriptions(): Promise<void> {
  subscriptionSync = subscriptionSync
    .catch(() => undefined)
    .then(async () => {
      if (recovery) await recovery;
      const session = connection?.session;
      if (session?.state === "ready") await session.subscribe(currentCursors());
    });
  return subscriptionSync;
}

function conversationIdFromStream(stream: string): string | undefined {
  return stream.startsWith("conv/") ? stream.slice(5) : undefined;
}

function dispatchNotice(type: string, data: unknown): void {
  if (
    type === "conversation.event" ||
    !(type in conversationChannelEventSchemas)
  )
    return;
  const name = type as NoticeName;
  const notice = {
    type: name,
    data: conversationChannelEventSchemas[name].parse(data),
  } as ConversationNotice;
  for (const observer of observers) observer.notice(notice);
}

export async function connectConversationChannel(wsUrl: string): Promise<void> {
  await connection?.close();
  const url = new URL(wsUrl);
  if (
    globalThis.location?.protocol === "http:" ||
    globalThis.location?.protocol === "https:"
  ) {
    url.host = globalThis.location.host;
    url.protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  }
  url.pathname = "/ws/conversations";
  const messages = createMessageFactory({
    source: {
      role: "ui",
      id: protocolClientId(),
      instanceId: protocolInstanceId(),
      name: "Nerve Conversations",
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
      if (state !== "ready")
        for (const observer of observers) observer.disconnected();
    },
    onError: (error) => console.warn("Conversation connection failed", error),
    createSession: ({ send, onDisconnect }) =>
      new ProtocolClientSession({
        createMessage: messages,
        capabilities,
        requiredCapabilities: ["encoding.json", "event.notify"],
        cursors: currentCursors,
        send,
        onDisconnect,
        onReady: () => {
          // RPC responses must be allowed through the receive queue while recovering.
          recovery = Promise.all(
            [...observers].map((observer) => observer.recover()),
          ).then(() => undefined);
          void recovery
            .then(async () => {
              recovery = undefined;
              await syncSubscriptions();
              resolve();
            })
            .catch((error) => {
              recovery = undefined;
              reject(error);
              connection?.session.disconnect(
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
        onSnapshotRequired: (stream) => {
          const id = conversationIdFromStream(stream);
          if (!id) return;
          // Do not await RPC recovery inside the protocol's serialized receive queue.
          void Promise.all(
            [...observers].map((observer) => observer.recover(id)),
          )
            .then(() => syncSubscriptions())
            .catch((error) => {
              connection?.session.disconnect(
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
        onStreamUnavailable: (stream) => {
          const id = conversationIdFromStream(stream);
          if (!id) return;
          cursors.delete(id);
          for (const observer of observers) observer.unavailable?.(id);
        },
        applyEvent: (_stream, envelope) => {
          if (envelope.type !== "conversation.event")
            throw new Error(`Unexpected conversation event: ${envelope.type}`);
          const event = conversationEventSchema.parse(envelope.data);
          if (
            _stream !== `conv/${event.conversationId}` ||
            envelope.seq !== event.sequence
          )
            throw new Error(
              "Conversation event does not match its replay envelope",
            );
          for (const observer of observers) observer.event(event);
          if (cursors.has(event.conversationId))
            cursors.set(
              event.conversationId,
              Math.max(cursors.get(event.conversationId) ?? 0, event.sequence),
            );
        },
        onNotify: (events) => {
          for (const event of events) dispatchNotice(event.type, event.data);
        },
      }),
  });
  void connection.start().catch(reject);
  return ready;
}

export function disconnectConversationChannel(): void {
  void connection?.close();
  connection = undefined;
  notifyReadyChange(false);
  for (const observer of observers) observer.disconnected();
}
