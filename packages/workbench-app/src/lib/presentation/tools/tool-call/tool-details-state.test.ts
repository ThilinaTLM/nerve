import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPreviewText,
  availableToolDetailSections,
  resolveToolDetailSection,
  serializeToolArguments,
} from "./tool-details-state";

test("serializeToolArguments memoizes by identity and keeps output", () => {
  let calls = 0;
  const value = {
    a: 1,
    toJSON() {
      calls++;
      return { a: 1 };
    },
  };
  const first = serializeToolArguments(value);
  assert.deepEqual(first, {
    text: JSON.stringify({ a: 1 }, null, 2),
    language: "json",
  });
  assert.equal(serializeToolArguments(value), first);
  assert.equal(calls, 1);
  assert.deepEqual(serializeToolArguments("raw"), { text: "raw" });
});

test("only sections with content are available, in display order", () => {
  assert.deepEqual(
    availableToolDetailSections({
      agentPreview: false,
      arguments: true,
      completeResult: true,
    }),
    ["arguments", "complete-result"],
  );
  assert.deepEqual(
    availableToolDetailSections({
      agentPreview: true,
      artifacts: true,
      arguments: true,
      completeResult: false,
    }),
    ["agent-preview", "artifacts", "arguments"],
  );
});

test("a missing tab falls back to the first section", () => {
  const available = ["arguments", "complete-result"] as const;
  assert.equal(
    resolveToolDetailSection(available, "complete-result"),
    "complete-result",
  );
  assert.equal(
    resolveToolDetailSection(available, "agent-preview"),
    "arguments",
  );
  assert.equal(resolveToolDetailSection(available, undefined), "arguments");
  assert.equal(resolveToolDetailSection([], undefined), undefined);
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
