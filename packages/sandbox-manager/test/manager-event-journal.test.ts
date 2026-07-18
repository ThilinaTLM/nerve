import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ManagerEventBus } from "../src/events/manager-event-bus.js";
import { ManagerEventJournal } from "../src/events/manager-event-journal.js";
import { MANAGER_EVENT_STORE_ID } from "../src/events/manager-events.js";
import { EventStore } from "../src/state/event-store.js";

const changedAt = "2026-01-01T00:00:00.000Z";

test("manager journal sequences persisted events while notify bypasses the log", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-journal-"));
  try {
    const store = new EventStore(dir);
    const bus = new ManagerEventBus();
    const delivered: number[] = [];
    const notified: string[] = [];
    bus.subscribe((event) => delivered.push(event.seq));
    bus.subscribeNotify((event) => notified.push(event.event.type));
    const journal = new ManagerEventJournal(store, bus);
    await journal.init();

    const [first, activity, third] = await Promise.all([
      journal.publish({
        type: "sandbox.lifecycle.changed",
        sandboxId: "sbx_one",
        payload: { current: "container_starting", changedAt },
      }),
      journal.publish({
        type: "sandbox.activity.changed",
        sandboxId: "sbx_one",
        payload: {
          runStatus: "running",
          updatedAt: changedAt,
        },
      }),
      journal.publish({
        type: "sandbox.daemon.connection_changed",
        sandboxId: "sbx_one",
        payload: { current: "connected", changedAt },
      }),
    ]);

    assert.deepEqual(
      [
        "seq" in first ? first.seq : undefined,
        "seq" in activity ? activity.seq : undefined,
        "seq" in third ? third.seq : undefined,
      ],
      [1, undefined, 2],
    );
    assert.deepEqual(delivered, [1, 2]);
    assert.deepEqual(notified, ["sandbox.activity.changed"]);
    assert.deepEqual(
      (await store.list(MANAGER_EVENT_STORE_ID)).map((event) => event.seq),
      [1, 2],
    );

    const restarted = new ManagerEventJournal(store, bus);
    await restarted.init();
    const afterRestart = await restarted.publish({
      type: "sandbox.lifecycle.changed",
      sandboxId: "sbx_one",
      payload: {
        previous: "container_starting",
        current: "ready",
        changedAt,
      },
    });
    assert.equal("seq" in afterRestart ? afterRestart.seq : undefined, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
