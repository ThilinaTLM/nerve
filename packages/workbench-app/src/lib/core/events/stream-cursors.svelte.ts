import type { StreamCursor } from "@nervekit/contracts";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

type SubscriptionSync = (cursors: readonly StreamCursor[]) => Promise<unknown>;

let syncSubscription: SubscriptionSync | undefined;
let syncScheduled = false;

export function currentEventCursors(): StreamCursor[] {
  return [...workspaceState.eventCursors]
    .map(([stream, processedSeq]) => ({ stream, processedSeq }))
    .sort((left, right) => left.stream.localeCompare(right.stream));
}

export function installEventCursors(
  cursors: readonly StreamCursor[],
  options: { replace?: boolean; sync?: boolean } = {},
): void {
  if (options.replace) workspaceState.eventCursors.clear();
  for (const cursor of cursors) {
    workspaceState.eventCursors.set(cursor.stream, cursor.processedSeq);
  }
  if (options.sync !== false) requestSubscriptionSync();
}

export function advanceEventCursor(stream: string, processedSeq: number): void {
  const current = workspaceState.eventCursors.get(stream) ?? 0;
  if (processedSeq > current)
    workspaceState.eventCursors.set(stream, processedSeq);
}

export function removeEventStream(stream: string): void {
  if (!workspaceState.eventCursors.delete(stream)) return;
  requestSubscriptionSync();
}

export function bindSubscriptionSync(sync: SubscriptionSync): () => void {
  syncSubscription = sync;
  return () => {
    if (syncSubscription === sync) syncSubscription = undefined;
  };
}

export function requestSubscriptionSync(): void {
  if (!syncSubscription || syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    const sync = syncSubscription;
    if (!sync) return;
    void sync(currentEventCursors()).catch((error: unknown) => {
      console.error("Stream subscription update failed", error);
    });
  });
}
