import assert from "node:assert/strict";
import test from "node:test";
import { ManagerEventBus } from "../src/events/manager-event-bus.js";
import { SandboxEventIngestor } from "../src/events/sandbox-event-ingestor.js";
import type {
  EventRange,
  SandboxEventStore,
  StoredSandboxEvent,
} from "../src/state/event-store.js";

const ts = "2026-01-01T00:00:00.000Z";

test("ingestion publishes nothing when atomic dense storage fails", async () => {
  const calls = { state: 0, conflicts: 0, insert: 0 };
  const store: SandboxEventStore = {
    streamState: async () => {
      calls.state += 1;
      return { latestSeq: 0, earliestAvailableSeq: 1 };
    },
    findConflicts: async () => {
      calls.conflicts += 1;
      return [];
    },
    appendBatch: async () => {
      calls.insert += 1;
      throw new Error("transaction rolled back");
    },
    append: async () => false,
    list: async () => [],
    readRange: async (): Promise<EventRange> => ({
      events: [],
      latestSeq: 0,
      earliestAvailableSeq: 1,
    }),
    archiveEpochIfAhead: async () => ({
      reset: false,
      previousLatestSeq: 0,
      latestSeq: 0,
      earliestAvailableSeq: 1,
    }),
    deleteAll: async () => undefined,
  };
  const bus = new ManagerEventBus();
  const published: StoredSandboxEvent[] = [];
  bus.subscribe((event) =>
    published.push({
      sandboxId: event.sandboxId ?? "",
      id: event.id,
      seq: event.seq,
      type: event.type,
      ts: event.ts,
      payload: event.payload,
    }),
  );
  const ingestor = new SandboxEventIngestor(store, bus);

  await assert.rejects(
    ingestor.ingestBatch("sbx_atomic", [
      {
        id: "evt_atomic_1",
        seq: 1,
        type: "run.started",
        ts,
        data: {
          conversationId: "conv_1",
          agentId: "agent_1",
          projectId: "proj_1",
          runId: "run_1",
          startedAt: ts,
        },
      },
    ]),
    /transaction rolled back/,
  );
  assert.deepEqual(calls, { state: 1, conflicts: 1, insert: 1 });
  assert.deepEqual(published, []);
});
