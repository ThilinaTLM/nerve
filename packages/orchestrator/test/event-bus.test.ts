import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { EventBus } from "../src/infrastructure/events/index.js";
import { IndexStore } from "../src/infrastructure/index-store/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-event-bus-"));
  roots.push(root);
  return root;
}

function makeIndex(home: string): IndexStore {
  const index = new IndexStore(join(home, "state.sqlite"));
  index.initialize();
  return index;
}

describe("EventBus", () => {
  it("returns persisted events when hydrating", async () => {
    const home = await tempHome();
    const bus = new EventBus(home);
    const durable = await bus.publish("project.created", {
      projectId: "proj_eventbus",
    });
    await bus.publish(
      "conversation.live.delta",
      { conversationId: "conv_eventbus" },
      { durability: "transient" },
    );

    const restored = new EventBus(home);
    await restored.hydrate();
    const events = restored.replaySince(0);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.id, durable.id);
    assert.equal(restored.latestSeq, durable.seq);
    assert.equal(restored.latestDurableSeq, durable.seq);
  });

  it("exposes the in-memory buffer floor for cheap reconnect replay", async () => {
    const home = await tempHome();
    const bus = new EventBus(home);
    assert.equal(bus.bufferedFloorSeq(), 0);

    const first = await bus.publish("project.created", { projectId: "p1" });
    const second = await bus.publish("project.created", { projectId: "p2" });

    assert.equal(bus.bufferedFloorSeq(), first.seq);
    assert.deepEqual(
      bus.replaySince(first.seq).map((event) => event.seq),
      [second.seq],
    );
  });

  it("hydrates the ring and replays from the index without reading the full log", async () => {
    const home = await tempHome();
    const index = makeIndex(home);
    const bus = new EventBus(home, index);
    const first = await bus.publish("project.created", { projectId: "p1" });
    const second = await bus.publish("project.created", { projectId: "p2" });
    await bus.publish(
      "conversation.live.delta",
      { conversationId: "conv_x" },
      { durability: "transient" },
    );

    const restored = new EventBus(home, index);
    await restored.hydrate();

    assert.equal(restored.latestSeq, second.seq);
    assert.equal(restored.latestDurableSeq, second.seq);
    assert.deepEqual(
      restored.replaySince(0).map((event) => event.seq),
      [first.seq, second.seq],
    );
    const replayed = await restored.replayPersistedSince(first.seq);
    assert.deepEqual(
      replayed.map((event) => event.seq),
      [second.seq],
    );
  });

  it("reconciles durable log entries missing from the index on hydrate", async () => {
    const home = await tempHome();
    const index = makeIndex(home);
    const bus = new EventBus(home, index);
    await bus.publish("project.created", { projectId: "p1" });

    // Simulate a crash between log append and index insert: append a durable
    // event straight to the log with a seq beyond the index high-water mark.
    await mkdir(join(home, "logs"), { recursive: true });
    const orphan = {
      seq: 2,
      id: "evt_orphan",
      ts: new Date().toISOString(),
      type: "project.created",
      durability: "durable",
      data: { projectId: "p2" },
    };
    await appendFile(
      join(home, "logs", "events.jsonl"),
      `${JSON.stringify(orphan)}\n`,
      "utf8",
    );

    const restored = new EventBus(home, index);
    await restored.hydrate();

    assert.equal(restored.latestSeq, 2);
    assert.equal(index.latestEventSeq(), 2);
    const replayed = await restored.replayPersistedSince(0);
    assert.deepEqual(
      replayed.map((event) => event.seq),
      [1, 2],
    );
    assert.deepEqual(
      index.eventsSince(1).map((event) => event.id),
      ["evt_orphan"],
    );
  });

  it("removes events for conversations from both the log and the index", async () => {
    const home = await tempHome();
    const index = makeIndex(home);
    const bus = new EventBus(home, index);
    const keep = await bus.publish("conversation.entry.appended", {
      conversationId: "conv_keep",
    });
    await bus.publish("conversation.entry.appended", {
      conversationId: "conv_drop",
    });

    await bus.removeEventsForConversations(["conv_drop"]);

    const remaining = await bus.replayPersistedSince(0);
    assert.deepEqual(
      remaining.map((event) => event.id),
      [keep.id],
    );
    assert.equal(index.counts().events, 1);
  });
});
