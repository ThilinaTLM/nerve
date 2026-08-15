import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolDraftProgressAccumulator } from "../src/domains/agents/run/tool-draft-progress.js";

describe("ToolDraftProgressAccumulator", () => {
  it("ingests hot-path deltas without allocating snapshots until sampled", () => {
    const accumulator = createToolDraftProgressAccumulator("write");
    assert.ok(accumulator);
    accumulator.ingest('{"path":"src/main.ts","content":"first');
    const first = accumulator.takeChangedSnapshot();
    assert.equal(first?.path, "src/main.ts");
    assert.equal(first?.generatedLineCount, 1);
    assert.equal(accumulator.takeChangedSnapshot(), undefined);

    accumulator.ingest('\\nsecond"}');
    const final = accumulator.takeChangedSnapshot();
    assert.equal(final?.generatedLineCount, 2);
    assert.match(final?.generatedPreview ?? "", /second/);
    assert.equal(accumulator.takeChangedSnapshot(), undefined);
  });
});
