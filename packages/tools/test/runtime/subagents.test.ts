import assert from "node:assert/strict";
import { it } from "node:test";
import { Check } from "typebox/value";
import { createSubagentHandlers } from "../../src/runtime/orchestration/subagents.js";
import { subagentToolDefinitions } from "../../src/catalog/definitions/orchestration/subagent.tools.js";

it("rejects ambiguous targets and promptless controls before backend side effects", async () => {
  const handlers = createSubagentHandlers(async () => {
    assert.fail("invalid child controls must not reach the backend");
  });
  for (const tool of ["subagent_prompt", "subagent_status", "subagent_stop"]) {
    for (const target of [
      {},
      { name: "Researcher", agentId: "agent_explorer" },
      { agentId: "conv_wrong" },
      { agentId: "" },
    ]) {
      await assert.rejects(
        handlers[tool]!({ ...target, prompt: "Inspect changes" }, {} as never),
        /exactly one|agentId/,
      );
    }
  }
  for (const control of [
    { configuration: { mode: "planning" } },
    { resume: true },
  ]) {
    await assert.rejects(
      handlers.subagent_prompt!(
        { agentId: "agent_explorer", ...control },
        {} as never,
      ),
      /prompt/,
    );
  }
});

it("accepts named developer or agent-ID child controls with one target", () => {
  for (const tool of ["subagent_prompt", "subagent_status", "subagent_stop"]) {
    const schema = subagentToolDefinitions.find(
      (item) => item.name === tool,
    )!.parameters;
    const input =
      tool === "subagent_prompt" ? { prompt: "Inspect the changes" } : {};
    for (const target of [
      { name: "Researcher" },
      { agentId: "agent_explorer" },
    ]) {
      assert.equal(Check(schema, { ...target, ...input }), true, tool);
      assert.equal(
        Check(schema, { ...target, ...input, authority: "autonomous" }),
        false,
        tool,
      );
    }
    for (const target of [
      {},
      { name: "Researcher", agentId: "agent_explorer" },
      { name: "" },
      { name: "a".repeat(81) },
      { agentId: "conv_wrong" },
      { id: "agent_explorer" },
    ]) {
      assert.equal(
        Check(schema, { ...target, ...input }),
        false,
        `${tool}: ${JSON.stringify(target)}`,
      );
    }
  }
});

it("accepts next-turn shared configuration and explicit resume without authority overrides", () => {
  const schema = subagentToolDefinitions.find(
    (item) => item.name === "subagent_prompt",
  )!.parameters;
  const assignment = {
    agentId: "agent_explorer",
    prompt: "Inspect the updated schema",
    resume: true,
    configuration: {
      model: null,
      thinkingLevel: "high",
      tools: ["read", "grep"],
      skills: [],
      instructions: "Report findings only",
      systemPrompt: null,
      mode: "coding",
      permissionLevel: "autonomous",
      permissionRuleSetId: "rules_test",
      projectDir: "/tmp/project",
      workspaceScope: { roots: ["/tmp/project"], readonly: true },
    },
  };
  assert.equal(Check(schema, assignment), true);
  assert.equal(Check(schema, { ...assignment, name: "Researcher" }), false);
  assert.equal(Check(schema, { ...assignment, resume: "true" }), false);
  assert.equal(Check(schema, { ...assignment, prompt: "" }), false);
  assert.equal(
    Check(schema, {
      ...assignment,
      configuration: { authority: "autonomous" },
    }),
    false,
  );
  assert.equal(
    Check(schema, { ...assignment, configuration: { preset: "standard" } }),
    false,
  );
  assert.equal(
    Check(schema, {
      ...assignment,
      configuration: { parentGrants: { configure: true } },
    }),
    false,
  );
});
