import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { removeManagedSandbox } from "../src/protocol/manager-sandbox-operations.js";
import { EventStore } from "../src/state/event-store.js";

it("deletes a removed sandbox's event journal rows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-remove-events-"));
  try {
    const events = new EventStore(dir);
    await events.append({
      sandboxId: "sbx_remove",
      id: "evt_remove_1",
      seq: 1,
      type: "run.started",
      ts: "2026-01-01T00:00:00.000Z",
      payload: {},
    });
    let sandboxDeleted = false;
    const state = {
      supervisor: {
        remove: async () => ({ sandboxId: "sbx_remove" }),
      },
      sandboxes: {
        delete: async () => {
          sandboxDeleted = true;
        },
      },
      events,
      eventJournal: { publish: async () => undefined },
      volumeProvider: {},
    };

    await removeManagedSandbox(state as never, {
      sandboxId: "sbx_remove",
      force: true,
      removeVolumes: false,
    });

    assert.equal(sandboxDeleted, true);
    assert.deepEqual(await events.list("sbx_remove"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps a removed sandbox record retryable when volume cleanup fails", async () => {
  let deleted = false;
  const state = {
    supervisor: {
      remove: async () => ({ sandboxId: "sbx_remove" }),
    },
    sandboxes: {
      delete: async () => {
        deleted = true;
      },
    },
    volumeProvider: {
      remove: async () => {
        throw new Error("protected volume cleanup failed");
      },
    },
  };

  await assert.rejects(
    removeManagedSandbox(state as never, {
      sandboxId: "sbx_remove",
      force: true,
      removeVolumes: true,
    }),
    /protected volume cleanup failed/,
  );
  assert.equal(deleted, false);
});
