import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommittedTimelineProjection } from "./timeline-projection.js";

const emptyInput = {
  entries: [],
  optimisticMessages: [],
  toolCalls: [],
  includeUnanchoredTerminalToolCalls: false,
};

describe("CommittedTimelineProjection", () => {
  it("reuses the durable projection while source identities stay stable", () => {
    const projection = new CommittedTimelineProjection();
    const first = projection.project(emptyInput);
    const second = projection.project({ ...emptyInput });

    assert.equal(second, first);
    assert.equal(second.items, first.items);
    assert.equal(second.context, first.context);
  });

  it("invalidates when a durable source identity changes", () => {
    const projection = new CommittedTimelineProjection();
    const first = projection.project(emptyInput);
    const second = projection.project({ ...emptyInput, entries: [] });

    assert.notEqual(second, first);
  });
});
