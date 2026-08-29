import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { measurementVersionForRow, uniqueRowKey } from "./transcript-row-model";

describe("transcript row model", () => {
  it("disambiguates duplicate virtualizer keys", () => {
    const seen = new Map<string, number>();
    assert.equal(uniqueRowKey("entry", seen), "entry");
    assert.equal(uniqueRowKey("entry", seen), "entry:duplicate:1");
    assert.equal(uniqueRowKey("entry", seen), "entry:duplicate:2");
  });

  it("keeps waiting and queued measurement revisions local", () => {
    const context = {
      approvalsByToolCallId: new Map(),
      questionsByToolCallId: new Map(),
      reviewsByToolCallId: new Map(),
      active: true,
    };
    assert.equal(
      measurementVersionForRow({ kind: "waiting", key: "waiting" }, context),
      "waiting",
    );
    assert.equal(
      measurementVersionForRow(
        {
          kind: "queued",
          key: "queued",
          prompt: {
            id: "prompt_1",
            status: "queued",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as never,
        },
        context,
      ),
      "queued:2026-01-01T00:00:00.000Z",
    );
  });
});
