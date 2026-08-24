import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CanonicalStore } from "../src/infrastructure/canonical-store/index.js";

test("canonical documents use revision compare-and-swap", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-store-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "state.sqlite"));
  await store.initialize();
  const first = await store.writeDocument({
    namespace: "test",
    scopeId: "global",
    documentId: "one",
    data: { value: 1 },
    expectedRevision: 0,
  });
  assert.equal(first.revision, 1);
  await assert.rejects(
    store.writeDocument({
      namespace: "test",
      scopeId: "global",
      documentId: "one",
      data: { value: 2 },
      expectedRevision: 0,
    }),
    /revision conflict/i,
  );
  await store.close();
});

test("canonical events are dense per stream and idempotent by durable intent", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-events-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "state.sqlite"));
  await store.initialize();
  const input = {
    stream: "workspace",
    intentId: "evt_canonical_test",
    eventType: "test.event",
    data: { value: 1 },
    occurredAt: "2026-08-24T00:00:00.000Z",
  };
  const first = await store.appendDurableEvent(input);
  await store.appendDurableEvent({
    ...input,
    stream: "conv/public",
    intentId: "evt_public_1",
  });
  const second = await store.appendDurableEvent({
    ...input,
    intentId: "evt_workspace_2",
  });
  await store.appendDurableEvent({
    ...input,
    stream: "internal/conv/public",
    intentId: "evt_internal_1",
  });
  const third = await store.appendDurableEvent({
    ...input,
    intentId: "evt_workspace_3",
  });

  assert.deepEqual(
    [first.sequence, second.sequence, third.sequence],
    [1, 2, 3],
  );
  assert.deepEqual(
    (await store.readDurableEvents("workspace", 1, 10)).map(
      (event) => event.sequence,
    ),
    [1, 2, 3],
  );
  assert.deepEqual(await store.durableEventBounds("workspace"), {
    stream: "workspace",
    earliestAvailableSeq: 1,
    latestSeq: 3,
  });
  assert.deepEqual(await store.appendDurableEvent(input), first);
  await assert.rejects(
    store.appendDurableEvent({ ...input, data: { value: 2 } }),
    /conflicting event intent/i,
  );
  await assert.rejects(
    store.appendDurableEvent({ ...input, stream: "conv/conflict" }),
    /conflicting event intent/i,
  );

  await store.removeDurableEventStream("workspace");
  const recreated = await store.appendDurableEvent({
    ...input,
    intentId: "evt_workspace_recreated",
  });
  assert.equal(recreated.sequence, 4);
  assert.deepEqual(await store.durableEventBounds("workspace"), {
    stream: "workspace",
    earliestAvailableSeq: 4,
    latestSeq: 4,
  });
  await store.close();
});

test("newer and checksum-drifted SQLite schemas are refused", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-version-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "state.sqlite");
  const store = new CanonicalStore(path);
  await store.initialize();
  await store.close();
  const database = new DatabaseSync(path);
  database
    .prepare(
      `INSERT INTO schema_migrations
       (version, name, checksum, applied_at_ms, duration_ms)
       VALUES (3, 'future', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 1, 0)`,
    )
    .run();
  database.close();
  const future = new CanonicalStore(path);
  await assert.rejects(future.initialize(), /newer than supported/i);
  await future.close();
});
