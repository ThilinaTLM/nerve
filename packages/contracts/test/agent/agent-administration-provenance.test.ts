import assert from "node:assert/strict";
import test from "node:test";
import { asyncSubagentControlSchema } from "../../src/domains/agents/async-subagents.js";
import {
  agentRecordSchema,
  agentConfigurationAcceptanceSchema,
  updateAgentRequestSchema,
} from "../../src/domains/agents/agent.js";

const proof = {
  agentId: "agent_child",
  parentAgentId: "agent_parent",
  parentStopGeneration: 3,
  childStopGeneration: 2,
  generation: 7,
  cause: "user_resume",
  runId: "run_admitted",
};
const control = {
  agentId: "agent_child",
  generation: 2,
  stopped: false,
  stopping: false,
  administrativeActivation: proof,
};
const receipt = {
  agentId: "agent_child",
  conversationId: "conv_shared",
  parentAgentId: "agent_parent",
  configurationRevision: 2,
  actor: { kind: "user", userId: "authenticated" },
  acceptedAt: "2026-10-07T00:00:00.000Z",
};
const agent = {
  id: receipt.agentId,
  rootAgentId: "agent_parent",
  parentAgentId: "agent_parent",
  conversationId: receipt.conversationId,
  projectId: "proj_one",
  projectDir: "/workspace",
  mode: "coding",
  permissionLevel: "supervised",
  workspaceScope: { roots: ["/workspace"] },
  createdAt: receipt.acceptedAt,
  updatedAt: receipt.acceptedAt,
  configurationRevision: 2,
  configurationAcceptances: [receipt],
};

test("administrative activation proof survives control parsing with exact current port fields", () => {
  assert.deepEqual(
    asyncSubagentControlSchema.parse(JSON.parse(JSON.stringify(control))),
    control,
  );
  assert.equal(
    asyncSubagentControlSchema.safeParse({
      ...control,
      administrativeActivation: undefined,
    }).success,
    true,
  );
  for (const administrativeActivation of [
    { ...proof, agentId: "agent_other" },
    { ...proof, parentAgentId: proof.agentId },
    { ...proof, generation: -1 },
    { ...proof, childStopGeneration: 0.5 },
    { ...proof, parentStopGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { ...proof, cause: "parent_resume" },
    { ...proof, runId: "not_a_run" },
    { ...proof, controlGeneration: 7 },
  ])
    assert.equal(
      asyncSubagentControlSchema.safeParse({
        ...control,
        administrativeActivation,
      }).success,
      false,
    );
  // Stale proof is retained as evidence; policy freshness checks are NOT fabricated by schema.
  assert.equal(
    asyncSubagentControlSchema.safeParse({
      ...control,
      generation: 9,
      stopped: true,
    }).success,
    true,
  );
});

test("configuration acceptance preserves exact actor identity, agent scope and revision order, never accepts public spoofing", () => {
  assert.equal(
    agentRecordSchema.parse(agent).configurationAcceptances?.[0]?.actor.kind,
    "user",
  );
  for (const actor of [
    { kind: "parent", agentId: "agent_parent" },
    { kind: "self", agentId: "agent_child" },
    { kind: "system", producer: "maintenance" },
  ])
    assert.equal(
      agentConfigurationAcceptanceSchema.safeParse({ ...receipt, actor })
        .success,
      true,
    );
  for (const invalid of [
    { ...receipt, actor: { kind: "user" } },
    { ...receipt, actor: { kind: "parent", agentId: "agent_other" } },
    { ...receipt, actor: { kind: "self", agentId: "agent_other" } },
    { ...receipt, configurationRevision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.equal(
      agentConfigurationAcceptanceSchema.safeParse(invalid).success,
      false,
    );
  assert.equal(
    agentRecordSchema.safeParse({
      ...agent,
      configurationAcceptances: [receipt, receipt],
    }).success,
    false,
  );
  assert.equal(
    agentRecordSchema.safeParse({
      ...agent,
      configurationAcceptances: [{ ...receipt, agentId: "agent_other" }],
    }).success,
    false,
  );
  assert.equal(
    agentRecordSchema.safeParse({
      ...agent,
      configurationAcceptances: [{ ...receipt, conversationId: "conv_other" }],
    }).success,
    false,
  );
  assert.deepEqual(
    updateAgentRequestSchema.parse({
      instructions: "Allowed",
      actor: receipt.actor,
      configurationAcceptances: [receipt],
      administrativeActivation: proof,
    }),
    { instructions: "Allowed" },
  );
  // A tool actor may overlay older ordinary config onto current static metadata.
  // Repository, not this captured actor schema, bounds receipts by durable current revision.
  assert.equal(
    agentRecordSchema.safeParse({ ...agent, configurationRevision: 1 }).success,
    true,
  );
});
