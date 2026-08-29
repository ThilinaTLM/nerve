import type { EventEnvelope, NotifyEvent } from "@nervekit/contracts";

export type SequencedWorkbenchEvent = EventEnvelope<Record<string, unknown>>;
export type WorkbenchNotifyEvent = NotifyEvent<Record<string, unknown>>;
export type WorkbenchEvent = SequencedWorkbenchEvent | WorkbenchNotifyEvent;
export type WorkbenchEventHandler = (
  event: WorkbenchEvent,
) => void | Promise<void>;

const handlersByType = new Map<string, Set<WorkbenchEventHandler>>();
const anyHandlers = new Set<WorkbenchEventHandler>();
export type EventsFlushedHandler = (events: WorkbenchEvent[]) => void;
const flushHandlers = new Set<EventsFlushedHandler>();

export function isSequencedEvent(
  event: WorkbenchEvent,
): event is SequencedWorkbenchEvent {
  return "seq" in event;
}

export function onEventsFlushed(handler: EventsFlushedHandler): () => void {
  flushHandlers.add(handler);
  return () => flushHandlers.delete(handler);
}

export function pendingNotifyCount(): number {
  return notifyQueue.length;
}

export function onEvent(
  type: string,
  handler: WorkbenchEventHandler,
): () => void {
  let handlers = handlersByType.get(type);
  if (!handlers) {
    handlers = new Set();
    handlersByType.set(type, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers?.delete(handler);
    if (handlers?.size === 0) handlersByType.delete(type);
  };
}

export function onAnyEvent(handler: WorkbenchEventHandler): () => void {
  anyHandlers.add(handler);
  return () => anyHandlers.delete(handler);
}

export function dispatchEvent(event: WorkbenchEvent): void {
  const handlers = [...(handlersByType.get(event.type) ?? []), ...anyHandlers];
  for (const handler of handlers) {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        void result.catch((caught) => reportHandlerError(event, caught));
      }
    } catch (caught) {
      reportHandlerError(event, caught);
    }
  }
}

export function clearEventHandlers(): void {
  handlersByType.clear();
  anyHandlers.clear();
  flushHandlers.clear();
  notifyQueue.length = 0;
  flushScheduled = false;
}

const notifyQueue: WorkbenchNotifyEvent[] = [];
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    flushNotifyEvents();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
}

/** Buffer best-effort notify delivery until the next animation frame. */
export function enqueueNotify(event: WorkbenchNotifyEvent): void {
  notifyQueue.push(event);
  scheduleFlush();
}

/** Apply one durable event and await all reducers before cursor advancement. */
export async function applyEventAndFlush(
  event: SequencedWorkbenchEvent,
): Promise<void> {
  const handlers = [...(handlersByType.get(event.type) ?? []), ...anyHandlers];
  for (const handler of handlers) await handler(event);
  for (const handler of flushHandlers) handler([event]);
}

/** Synchronously drain the best-effort notify queue in FIFO order. */
export function flushNotifyEvents(): void {
  const delivered: WorkbenchNotifyEvent[] = [];
  for (let index = 0; index < notifyQueue.length; index += 1) {
    const event = notifyQueue[index] as WorkbenchNotifyEvent;
    delivered.push(event);
    dispatchEvent(event);
  }
  notifyQueue.length = 0;
  if (delivered.length === 0) return;
  for (const handler of flushHandlers) {
    try {
      handler(delivered);
    } catch (caught) {
      console.error("Workbench notify flush handler failed", caught);
    }
  }
}

function reportHandlerError(event: WorkbenchEvent, error: unknown): void {
  console.error("Workbench event handler failed", {
    type: event.type,
    seq: isSequencedEvent(event) ? event.seq : undefined,
    error,
  });
}
