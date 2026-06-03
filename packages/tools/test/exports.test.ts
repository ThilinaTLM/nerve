import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coreToolDefinitionByName,
  coreToolDefinitions,
  coreToolDescriptors,
  executeTool,
  hasDangerousCommandPattern,
  hasShellControlOperator,
  isKnownReadOnlyCommand,
  isLikelyLongRunningCommand,
  resolveToolPath,
  toolRiskForName,
} from "../src/index.js";

describe("public source exports", () => {
  it("keeps the intended @nerve/tools source exports available", () => {
    assert.equal(typeof executeTool, "function");
    assert.equal(typeof resolveToolPath, "function");
    assert.equal(typeof toolRiskForName, "function");
    assert.equal(typeof coreToolDefinitionByName, "function");
    assert.equal(typeof hasDangerousCommandPattern, "function");
    assert.equal(typeof hasShellControlOperator, "function");
    assert.equal(typeof isKnownReadOnlyCommand, "function");
    assert.equal(typeof isLikelyLongRunningCommand, "function");
    assert.ok(coreToolDefinitions.length > 0);
    assert.ok(coreToolDescriptors.length > 0);
    assert.equal(toolRiskForName("read"), "read");
    assert.equal(toolRiskForName("ask_user"), "interaction");
  });
});
