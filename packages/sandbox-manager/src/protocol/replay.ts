import type { EventStore } from "../state/event-store.js";
export async function replayEvents(
  store: EventStore,
  sandboxId: string,
  afterSeq = 0,
): Promise<unknown[]> {
  return (await store.list(sandboxId)).filter(
    (event) => (event.seq ?? 0) > afterSeq,
  );
}
