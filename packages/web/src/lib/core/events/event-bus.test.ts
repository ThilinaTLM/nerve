import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { WorkbenchEvent } from "./event-bus";
import {
  clearEventHandlers,
  dispatchEvent,
  onAnyEvent,
  onEvent,
} from "./event-bus";

function event(type: string): WorkbenchEvent {
  return {
    id: `evt-${type}`,
    type,
    seq: 1,
    ts: new Date().toISOString(),
    durability: "transient",
    data: {},
  };
}

afterEach(() => clearEventHandlers());

describe("event bus", () => {
  it("dispatches exact-type and global handlers", () => {
    const seen: string[] = [];
    onEvent("project.created", (candidate) => {
      seen.push(`specific:${candidate.type}`);
    });
    onAnyEvent((candidate) => {
      seen.push(`any:${candidate.type}`);
    });

    dispatchEvent(event("project.created"));

    assert.deepEqual(seen, ["specific:project.created", "any:project.created"]);
  });

  it("unsubscribes handlers", () => {
    const seen: string[] = [];
    const unsubscribe = onEvent("project.created", () => {
      seen.push("called");
    });

    unsubscribe();
    dispatchEvent(event("project.created"));

    assert.deepEqual(seen, []);
  });
});
