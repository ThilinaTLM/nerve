import type { NotifyEvent } from "@nervekit/contracts/events";

export type WorkbenchEvent = NotifyEvent<Record<string, unknown>>;
type Handler = (event: WorkbenchEvent) => void | Promise<void>;
const handlers = new Map<string, Set<Handler>>();
const anyHandlers = new Set<Handler>();
const snapshotHandlers = new Set<() => void | Promise<void>>();
let recovering = false;
const pending: WorkbenchEvent[] = [];

export function onEvent(type: string, handler: Handler): () => void {
  const listeners = handlers.get(type) ?? new Set<Handler>();
  handlers.set(type, listeners);
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
    if (!listeners.size) handlers.delete(type);
  };
}

export function onAnyEvent(handler: Handler): () => void {
  anyHandlers.add(handler);
  return () => {
    anyHandlers.delete(handler);
  };
}

export function onWorkbenchReconnect(
  handler: () => void | Promise<void>,
): () => void {
  snapshotHandlers.add(handler);
  return () => {
    snapshotHandlers.delete(handler);
  };
}

export function beginWorkbenchRecovery(): void {
  recovering = true;
  pending.length = 0;
}

export async function recoverWorkbenchPanels(): Promise<void> {
  await Promise.all([...snapshotHandlers].map((handler) => handler()));
  recovering = false;
  for (const event of pending.splice(0)) dispatchEvent(event);
}

export function dispatchEvent(event: WorkbenchEvent): void {
  if (recovering) {
    pending.push(event);
    return;
  }
  for (const handler of [...(handlers.get(event.type) ?? []), ...anyHandlers]) {
    try {
      void Promise.resolve(handler(event)).catch((error) =>
        console.error("Workbench notice handler failed", error),
      );
    } catch (error) {
      console.error("Workbench notice handler failed", error);
    }
  }
}
