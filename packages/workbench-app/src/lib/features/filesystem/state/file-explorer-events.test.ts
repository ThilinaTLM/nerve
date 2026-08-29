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
  let refreshes = 0;
  const unregister = registerFileExplorerEventHandler("proj_active", () => {
    refreshes += 1;
  });

  dispatchEvent(change({ projectId: "proj_other", source: "filesystem" }));
  dispatchEvent(change({ projectId: "active", source: "filesystem" }));
  dispatchEvent(change({ projectId: "proj_active", source: "other" }));
  assert.equal(refreshes, 0);

  dispatchEvent(change({ projectId: "proj_active", source: "filesystem" }));
  assert.equal(refreshes, 1);

  unregister();
  dispatchEvent(change({ projectId: "proj_active", source: "filesystem" }));
  assert.equal(refreshes, 1);
});
