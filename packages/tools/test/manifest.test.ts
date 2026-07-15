import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolGroupNameSchema, toolNameSchema } from "@nervekit/contracts";
import {
  allToolDescriptors,
  classifyToolRisk,
  hostToolDefinitions,
  localToolDefinitions,
  toolDefinitionsByGroup,
  toolHasTrait,
  toolManifest,
} from "../src/index.js";

const sorted = (values: readonly string[]) => [...values].sort();

describe("canonical tool manifest", () => {
  it("has exact schema parity and unique complete metadata", () => {
    assert.deepEqual(
      sorted(toolManifest.map((definition) => definition.name)),
      sorted(toolNameSchema.options),
    );
    assert.equal(
      new Set(toolManifest.map((definition) => definition.name)).size,
      toolManifest.length,
    );
    for (const definition of toolManifest) {
      assert.ok(definition.group, definition.name);
      assert.ok(definition.baseRisk, definition.name);
      assert.ok(definition.executionKind, definition.name);
      assert.ok(Array.isArray(definition.traits), definition.name);
    }
  });

  it("derives execution ownership and descriptors", () => {
    assert.equal(
      localToolDefinitions.length + hostToolDefinitions.length,
      toolManifest.length,
    );
    for (const definition of localToolDefinitions) {
      assert.equal(typeof definition.executor, "function", definition.name);
    }
    for (const definition of hostToolDefinitions) {
      assert.equal("executor" in definition, false, definition.name);
    }
    assert.deepEqual(
      allToolDescriptors,
      toolManifest.map((definition) => ({
        name: definition.name,
        risk: definition.baseRisk,
        description: definition.description,
        group: definition.group,
        executionKind: definition.executionKind,
        traits: [...definition.traits],
      })),
    );
  });

  it("assigns every tool to exactly one manifest group including integrations", () => {
    const grouped = toolGroupNameSchema.options.flatMap((group) =>
      toolDefinitionsByGroup(group).map((definition) => definition.name),
    );
    assert.deepEqual(sorted(grouped), sorted(toolNameSchema.options));
    assert.ok(toolDefinitionsByGroup("jira").length > 0);
    assert.ok(toolDefinitionsByGroup("confluence").length > 0);
  });

  it("classifies dynamic bash and task risk", () => {
    assert.equal(
      classifyToolRisk("bash", { command: "git status --short" }),
      "read",
    );
    assert.equal(
      classifyToolRisk("bash", { command: "rm -rf dist" }),
      "destructive",
    );
    assert.equal(
      classifyToolRisk("task_start", {
        command: "rm -rf dist",
      }),
      "destructive",
    );
    assert.equal(
      classifyToolRisk("task_start", { command: "pnpm dev" }),
      "command",
    );
    assert.equal(toolHasTrait("jira_get_issue", "read_only_network"), true);
    assert.equal(toolHasTrait("jira_create_issue", "credentialed"), true);
  });
});
