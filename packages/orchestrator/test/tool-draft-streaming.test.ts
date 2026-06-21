import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldPublishToolDraftProgress,
  shouldStreamToolDraftArguments,
} from "../src/domains/agents/run/tool-draft-streaming.js";

describe("tool draft argument streaming policy", () => {
  it("does not stream large write/edit/smart_edit tool arguments", () => {
    assert.equal(shouldStreamToolDraftArguments("write"), false);
    assert.equal(shouldStreamToolDraftArguments("edit"), false);
    assert.equal(shouldStreamToolDraftArguments("smart_edit"), false);
  });

  it("does not stream before the tool name is known", () => {
    assert.equal(shouldStreamToolDraftArguments(undefined), false);
  });

  it("streams representative small operational tool arguments", () => {
    for (const toolName of [
      "bash",
      "python",
      "read",
      "grep",
      "task_logs",
      "explore",
    ]) {
      assert.equal(shouldStreamToolDraftArguments(toolName), true, toolName);
    }
  });

  it("publishes sanitized progress for write/edit/smart_edit drafts only", () => {
    assert.equal(shouldPublishToolDraftProgress("write"), true);
    assert.equal(shouldPublishToolDraftProgress("edit"), true);
    assert.equal(shouldPublishToolDraftProgress("smart_edit"), true);
    assert.equal(shouldPublishToolDraftProgress("python"), false);
    assert.equal(shouldPublishToolDraftProgress("bash"), false);
    assert.equal(shouldPublishToolDraftProgress(undefined), false);
  });
});
