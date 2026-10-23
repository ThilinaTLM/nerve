import assert from "node:assert/strict";
import { test } from "node:test";
import {
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import { withAgentProfiles } from "./turn-resources.adapter.js";

const tools = [
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
  "ask_user",
].map((name) => toolDefinitionByName(name) as ToolDefinition);

void test("no usable profiles or existing children removes delegation tools", () => {
  assert.deepEqual(
    withAgentProfiles(tools, []).map((tool) => tool.name),
    ["ask_user"],
  );
});

void test("usable profile names constrain new assignments without mutating the catalog", () => {
  const original = JSON.stringify(tools);
  const result = withAgentProfiles(tools, [
    { name: "research", description: "Research" },
  ]);
  const prompt = result.find((tool) => tool.name === "subagent_prompt")!;
  const schema = prompt.parameters as unknown as {
    properties: {
      assignments: { items: { properties: { profile: { enum: string[] } } } };
    };
  };
  assert.deepEqual(
    schema.properties.assignments.items.properties.profile.enum,
    ["research"],
  );
  assert.equal(JSON.stringify(tools), original);
});

void test("existing children remain addressable without offering new profile assignments", () => {
  const result = withAgentProfiles(tools, [], true);
  assert.equal(result.length, tools.length);
  const prompt = result.find((tool) => tool.name === "subagent_prompt")!;
  const schema = prompt.parameters as unknown as {
    properties: {
      assignments: { items: { properties: Record<string, unknown> } };
    };
  };
  assert.equal(
    Object.hasOwn(schema.properties.assignments.items.properties, "profile"),
    false,
  );
  assert.match(prompt.description, /existing sub-agents/);
});
