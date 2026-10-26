import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOperationParams,
  parseOperationResult,
} from "../../src/operations/catalog.js";

test("projectInstructions.list requires project identity and returns file-to-subtree applicability", () => {
  assert.deepEqual(
    parseOperationParams("projectInstructions.list", { projectId: "proj_one" }),
    { projectId: "proj_one" },
  );
  assert.throws(() => parseOperationParams("projectInstructions.list", {}));
  assert.throws(() =>
    parseOperationParams("projectInstructions.list", { projectId: "" }),
  );
  const result = {
    files: [
      { path: "/project/AGENTS.md", appliesTo: "/project" },
      { path: "/project/nested/AGENTS.md", appliesTo: "/project/nested" },
    ],
  };
  assert.deepEqual(
    parseOperationResult("projectInstructions.list", result),
    result,
  );
  assert.deepEqual(
    parseOperationResult("projectInstructions.list", { files: [] }),
    { files: [] },
  );
  assert.throws(() =>
    parseOperationResult("projectInstructions.list", {
      files: [{ path: "/project/AGENTS.md" }],
    }),
  );
  assert.throws(() =>
    parseOperationResult("projectInstructions.list", {
      files: [{ path: "", appliesTo: "/project" }],
    }),
  );
});
