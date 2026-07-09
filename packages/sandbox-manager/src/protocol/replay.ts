import type {
  SandboxEventStore,
  StoredSandboxEvent,
} from "../state/event-store.js";
export async function replayEvents(
  store: SandboxEventStore,
  sandboxId: string,
  afterSeq = 0,
): Promise<StoredSandboxEvent[]> {
  return (await store.list(sandboxId)).filter(
    (event) =>
      (event.seq ?? 0) > afterSeq &&
      (event.durability ??
        (event.type === "run.delta" ? "transient" : "durable")) === "durable",
  );
}
