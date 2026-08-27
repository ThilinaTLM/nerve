import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolView } from "../../views/tool-result-view.js";
import {
  initialToolDetailSection,
  segmentRawText,
} from "./tool-details-state.js";

describe("tool details state", () => {
  it("prioritizes formatted views and otherwise the agent preview", () => {
    const bash = { kind: "bash", output: "done" } as ToolView;
    const jira = { kind: "jira" } as ToolView;
    const generic = { kind: "generic" } as ToolView;
    assert.equal(initialToolDetailSection(bash), "formatted");
    assert.equal(initialToolDetailSection(jira, true), "formatted");
    assert.equal(initialToolDetailSection(generic), "agent-preview");
  });

  it("segments giant raw-result lines into bounded virtual rows", () => {
    const rows = segmentRawText(`${"x".repeat(4_500)}\nlast`, 2_000);
    assert.deepEqual(
      rows.map((row) => row.text.length),
      [2_000, 2_000, 500, 4],
    );
  });
});
