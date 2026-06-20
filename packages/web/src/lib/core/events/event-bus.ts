import type { EventEnvelope } from "$lib/api";

export type WorkbenchEvent = EventEnvelope<Record<string, unknown>>;
export type WorkbenchEventHandler = (
  event: WorkbenchEvent,
) => void | Promise<void>;

const handlersByType = new Map<string, Set<WorkbenchEventHandler>>();
const anyHandlers = new Set<WorkbenchEventHandler>();

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
  return () => {
    anyHandlers.delete(handler);
  };
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
  eventQueue.length = 0;
  flushScheduled = false;
}

// --- Coalesced delivery -----------------------------------------------------
// Incoming envelopes are buffered and flushed once per animation frame so a
// burst of streaming deltas (content/tool output) collapses into a single
// reactive pass instead of one render per frame-event. FIFO order is preserved.

const eventQueue: WorkbenchEvent[] = [];
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    flushEvents();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
}

/**
 * Buffer an event for batched delivery on the next animation frame. Use this
 * for high-frequency transport events; ordering and per-batch atomicity are
 * preserved by {@link flushEvents}.
 */
export function enqueueEvent(event: WorkbenchEvent): void {
  eventQueue.push(event);
  scheduleFlush();
}

/**
 * Synchronously drain the buffered event queue in FIFO order. Safe to call for
 * deterministic teardown (disconnect) and in tests.
 */
export function flushEvents(): void {
  for (let index = 0; index < eventQueue.length; index += 1) {
    dispatchEvent(eventQueue[index] as WorkbenchEvent);
  }
  eventQueue.length = 0;
}

function reportHandlerError(event: WorkbenchEvent, error: unknown): void {
  console.error("Workbench event handler failed", {
    type: event.type,
    seq: event.seq,
    error,
  });
}
