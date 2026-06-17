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
}

function reportHandlerError(event: WorkbenchEvent, error: unknown): void {
  console.error("Workbench event handler failed", {
    type: event.type,
    seq: event.seq,
    error,
  });
}
