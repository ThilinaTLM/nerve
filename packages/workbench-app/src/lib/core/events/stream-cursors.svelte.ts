import type { StreamCursor } from "@nervekit/contracts";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

/**
 * Applies the desired cursor set to the server, or reports "skipped" when the
 * protocol session cannot accept subscriptions yet. Skipped or failed syncs
 * stay dirty and are retried; a lost subscription update must never leave the
 * client silently detached from live delivery.
 */
type SubscriptionSync = (
  cursors: readonly StreamCursor[],
) => Promise<"applied" | "skipped">;

const SYNC_RETRY_MS = 1_000;
let syncSubscription: SubscriptionSync | undefined;
let syncScheduled = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (syncSubscription !== sync) return;
    syncSubscription = undefined;
    clearRetry();
  };
}

export function requestSubscriptionSync(): void {
  if (!syncSubscription || syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => void runSubscriptionSync());
}

async function runSubscriptionSync(): Promise<void> {
  syncScheduled = false;
  clearRetry();
  const sync = syncSubscription;
  if (!sync) return;
  try {
    const result = await sync(currentEventCursors());
    if (result === "skipped") scheduleRetry();
  } catch (error) {
    console.error("Stream subscription update failed; retrying", error);
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer !== undefined || !syncSubscription) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    requestSubscriptionSync();
  }, SYNC_RETRY_MS);
}

function clearRetry(): void {
  if (retryTimer === undefined) return;
  clearTimeout(retryTimer);
  retryTimer = undefined;
}
