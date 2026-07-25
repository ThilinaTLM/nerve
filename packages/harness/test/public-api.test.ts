import assert from "node:assert/strict";
import { it } from "node:test";
import {
  Agent,
  AgentHarness,
  compact,
  Conversation,
  NodeExecutionEnv,
  resolveAgentModel,
  streamProxy,
} from "../src/index.js";

it("exposes the supported harness API from the main entrypoint", () => {
  assert.equal(typeof Agent, "function");
  assert.equal(typeof AgentHarness, "function");
  assert.equal(typeof Conversation, "function");
  assert.equal(typeof NodeExecutionEnv, "function");
  assert.equal(typeof compact, "function");
  assert.equal(typeof resolveAgentModel, "function");
  assert.equal(typeof streamProxy, "function");
});
