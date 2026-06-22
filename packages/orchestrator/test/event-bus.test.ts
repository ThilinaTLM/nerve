import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { EventBus } from "../src/infrastructure/events/index.js";

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
    const events = await restored.hydrate();

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
});
