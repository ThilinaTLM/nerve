import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { WorkbenchNotifyEvent } from "$lib/application/events/event-bus";
import {
  clearEventHandlers,
  dispatchEvent,
} from "$lib/application/events/event-bus";
import { registerFileExplorerEventHandler } from "./file-explorer-events";

const ts = "2026-08-16T00:00:00.000Z";

function change(data: Record<string, unknown>): WorkbenchNotifyEvent {
  return {
    id: "evt_filesystem_change",
    ts,
    type: "filesystem.project.changed",
    data,
  };
}

afterEach(() => clearEventHandlers());

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
