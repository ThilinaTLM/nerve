import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldStreamToolDraftArguments } from "../src/agent-runner/tool-draft-streaming.js";

describe("tool draft argument streaming policy", () => {
  it("does not stream large write/edit tool arguments", () => {
    assert.equal(shouldStreamToolDraftArguments("write"), false);
    assert.equal(shouldStreamToolDraftArguments("edit"), false);
  });

  it("does not stream before the tool name is known", () => {
    assert.equal(shouldStreamToolDraftArguments(undefined), false);
  });

  it("streams representative small operational tool arguments", () => {
    for (const toolName of [
      "bash",
      "read",
      "grep",
      "process_logs",
      "subagent_run",
    ]) {
      assert.equal(shouldStreamToolDraftArguments(toolName), true, toolName);
    }
  });
});
