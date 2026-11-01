import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPreviewText,
  availableToolDetailSections,
  resolveToolDetailSection,
} from "./tool-details-state";

test("only sections with content are available, in display order", () => {
  assert.deepEqual(
    availableToolDetailSections({
      formatted: true,
      agentPreview: false,
      arguments: true,
      completeResult: true,
    }),
    ["formatted", "arguments", "complete-result"],
  );
});

test("a missing tab falls back to the preferred, then the first section", () => {
  const available = ["arguments", "complete-result"] as const;
  assert.equal(
    resolveToolDetailSection(available, "complete-result", "formatted"),
    "complete-result",
  );
  assert.equal(
    resolveToolDetailSection(available, "agent-preview", "arguments"),
    "arguments",
  );
  assert.equal(
    resolveToolDetailSection(available, undefined, "formatted"),
    "arguments",
  );
  assert.equal(resolveToolDetailSection([], undefined, "formatted"), undefined);
});

test("agent preview text joins text blocks and skips images", () => {
  assert.equal(
    agentPreviewText({
      blocks: [
        { type: "text", text: "a" },
        { type: "image" },
        { type: "text", text: "b" },
      ],
    }),
    "a\n\nb",
  );
  assert.equal(agentPreviewText(undefined), "");
});
