import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkbenchEvent } from "$lib/application/events/workbench-event-bus";
import { dispatchEvent } from "$lib/application/events/workbench-event-bus";
import { registerFileExplorerEventHandler } from "./file-explorer-events";

const ts = "2026-08-16T00:00:00.000Z";

function change(data: Record<string, unknown>): WorkbenchEvent {
  return {
    id: "evt_filesystem_change",
    ts,
    type: "filesystem.project.changed",
    data,
  };
}

test("refreshes only for valid changes to the active project and unregisters", () => {
  const changes: unknown[] = [];
  const unregister = registerFileExplorerEventHandler(
    "proj_active",
    (change) => {
      changes.push(change);
    },
  );

  dispatchEvent(change({ projectId: "proj_other", generation: 1 }));
  dispatchEvent(change({ projectId: "active", generation: 1 }));
  dispatchEvent(change({ projectId: "proj_active", generation: "1" }));
  assert.equal(changes.length, 0);

  dispatchEvent(
    change({
      projectId: "proj_active",
      generation: 1,
      directories: ["src"],
      fullRefreshRequired: false,
    }),
  );
  assert.deepEqual(changes, [
    { generation: 1, directories: ["src"], fullRefreshRequired: false },
  ]);

  unregister();
  dispatchEvent(
    change({
      projectId: "proj_active",
      generation: 2,
      directories: [],
      fullRefreshRequired: true,
    }),
  );
  assert.equal(changes.length, 1);
});
