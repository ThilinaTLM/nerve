import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { getAgentSnapshotForToolCall } from "../../../src/domains/tools/orchestration/agent-tool-adapter.js";
import { buildToolService, agent } from "./tool-service-test-fixture.js";
import type { AgentRecord } from "@nervekit/contracts/agents";

function configuredActor(projectDir: string): AgentRecord {
  return {
    ...agent("supervised"),
    projectDir,
    workspaceScope: { roots: [projectDir], readonly: false },
    permissionRuleSetId: "supervised",
    model: { provider: "original-provider", modelId: "original-model" },
    thinkingLevel: "high",
    tools: ["subagent_new", "read"],
    skills: ["original-skill"],
    instructions: "Original delegation instructions",
    systemPrompt: "Original composed prompt",
    configurationRevision: 4,
  };
}

it("restores every original delegation default and ordinary authority after provider-time edits, approval and restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-full-tool-config-"));
  const source = join(home, "source");
  const newer = join(home, "newer");
  await mkdir(source);
  await mkdir(newer);
  const current = configuredActor(source);
  const originalActor = structuredClone(current);
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const permissionContext =
    await f.service.capturePermissionContext(originalActor);
  const toolAuthority = await f.service.captureToolAuthority(
    originalActor,
    permissionContext,
    { configurationProvenance: "resolved" },
  );
  // Committed while the originating provider invocation is in flight.
  Object.assign(current, {
    projectDir: newer,
    workspaceScope: { roots: [newer], readonly: true },
    model: { provider: "new-provider", modelId: "new-model" },
    thinkingLevel: "off",
    tools: ["read"],
    skills: [],
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    mode: "planning",
    instructions: "New instructions",
    systemPrompt: "New prompt",
    configurationRevision: 5,
  });
  const pending = await f.service.requestTool(
    current,
    "subagent_new",
    { name: "Original defaults" },
    {
      agentSnapshot: originalActor,
      permissionContext,
      toolAuthority,
      forceApproval: true,
      durableSuspend: true,
    },
  );
  assert.equal(pending.toolCall.status, "waiting");
  await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-original-delegation",
    },
    f.journalCommit,
  );
  current.configurationRevision = 6;
  current.instructions = "Accepted after approval";
  current.budget = { ...current.budget, maxConcurrentChildren: 1 };
  current.parentGrants = { prompt: false, configure: false, stop: false };
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  const stored = await restarted.service.getToolCallDetails(
    pending.toolCall.id,
  );
  const callbackActor = getAgentSnapshotForToolCall(current, stored);
  for (const field of [
    "mode",
    "permissionLevel",
    "permissionRuleSetId",
    "model",
    "thinkingLevel",
    "projectDir",
    "workspaceScope",
    "systemPrompt",
    "instructions",
    "tools",
    "skills",
    "configurationRevision",
  ] as const) {
    assert.deepEqual(
      callbackActor[field],
      originalActor[field],
      `delegation callback must use original ${field}`,
    );
  }
  assert.equal(callbackActor.effectiveConfigurationRevision, 4);
  assert.equal(stored.authoritySnapshot?.configurationProvenance, "resolved");
  // Static grants/budgets and emergency controls are not ordinary settings.
  assert.deepEqual(callbackActor.budget, current.budget);
  assert.deepEqual(callbackActor.parentGrants, current.parentGrants);
  assert.equal(
    (await restarted.service.claimApprovedExecution(stored.id)).status,
    "running",
  );
  const nextTurn = await restarted.service.requestTool(
    current,
    "subagent_new",
    { name: "New turn" },
  );
  assert.equal(nextTurn.toolCall.status, "denied");
});

it("direct host approval persists accepted full configuration without borrowing latest defaults on restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-direct-host-config-"));
  const current = configuredActor(home);
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "subagent_new",
    { name: "Host original" },
    { forceApproval: true, durableSuspend: true },
  );
  current.model = {
    provider: "replacement-provider",
    modelId: "replacement-model",
  };
  current.permissionLevel = "read_only";
  current.permissionRuleSetId = "read_only";
  current.instructions = "Replacement";
  current.tools = [];
  await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-direct-host",
    },
    f.journalCommit,
  );
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  const stored = await restarted.service.getToolCallDetails(
    pending.toolCall.id,
  );
  assert.equal(stored.authoritySnapshot?.configurationProvenance, "accepted");
  const callbackActor = getAgentSnapshotForToolCall(current, stored);
  assert.deepEqual(callbackActor.model, {
    provider: "original-provider",
    modelId: "original-model",
  });
  assert.equal(callbackActor.permissionLevel, "supervised");
  assert.deepEqual(callbackActor.tools, ["subagent_new", "read"]);
  assert.equal(callbackActor.instructions, "Original delegation instructions");
  assert.equal(
    (await restarted.service.claimApprovedExecution(stored.id)).status,
    "running",
  );
});

it("blocks historical scope-only delegation approval instead of silently using current parent configuration", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-tool-config-"));
  const current = configuredActor(home);
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "subagent_new",
    { name: "Legacy" },
    { forceApproval: true, durableSuspend: true },
  );
  const approved = await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-legacy",
    },
    f.journalCommit,
  );
  await f.journal.commit(current.conversationId, {
    kind: "test.legacy_scope_only",
    events: [
      {
        kind: "tool_call.upserted",
        conversationId: current.conversationId,
        toolCall: {
          ...approved.toolCall,
          revision: approved.toolCall.revision + 1,
          authoritySnapshot: {
            ...approved.toolCall.authoritySnapshot!,
            configuration: undefined,
            configurationProvenance: "legacy_scope_only",
          },
        },
      },
    ],
  });
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  const stored = await restarted.service.getToolCallDetails(
    pending.toolCall.id,
  );
  assert.throws(
    () => getAgentSnapshotForToolCall(current, stored),
    /TOOL_CONFIGURATION_SNAPSHOT_UNAVAILABLE/,
  );
  await assert.rejects(
    restarted.service.claimApprovedExecution(stored.id),
    /TOOL_CONFIGURATION_SNAPSHOT_UNAVAILABLE/,
  );
  assert.equal(
    restarted.service.getToolCall(stored.id).supervision?.status,
    "approved",
  );
});

it("full original delegation configuration does not override live stop or immutable read-only ceiling", async (t) => {
  for (const fence of ["stop", "ceiling"] as const) {
    const home = await mkdtemp(join(tmpdir(), "nerve-full-config-fence-"));
    const current = configuredActor(home);
    const f = buildToolService(home, current);
    t.after(async () => {
      await f.journal.close();
      await rm(home, { recursive: true, force: true });
    });
    const pending = await f.service.requestTool(
      current,
      "subagent_new",
      { name: "Do not dispatch" },
      { forceApproval: true, durableSuspend: true },
    );
    await f.service.projectApprovalDecision(
      {
        toolCallId: pending.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-before-fence",
      },
      f.journalCommit,
    );
    if (fence === "stop") current.activationState = "paused";
    else current.readOnlyCeiling = true;
    const callbackActor = getAgentSnapshotForToolCall(
      current,
      pending.toolCall,
    );
    assert.equal(callbackActor.activationState, current.activationState);
    assert.equal(callbackActor.readOnlyCeiling, current.readOnlyCeiling);
    await assert.rejects(
      f.service.claimApprovedExecution(pending.toolCall.id),
      /paused|read-only authority/,
    );
  }
});

it("rejects a resolved marker on raw inherited settings and mixed actor/config snapshots", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-provenance-"));
  const current = configuredActor(home);
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const context = await f.service.capturePermissionContext(current);
  await assert.rejects(
    f.service.captureToolAuthority(
      { ...current, tools: null, skills: null },
      context,
      { configurationProvenance: "resolved" },
    ),
    /concrete model, permission, prompt, tools and skills/,
  );
  const toolAuthority = await f.service.captureToolAuthority(current, context);
  current.model = { provider: "wrong-parent", modelId: "new-default" };
  await assert.rejects(
    f.service.requestTool(
      current,
      "subagent_new",
      { name: "Mixed" },
      {
        toolAuthority,
        permissionContext: context,
        forceApproval: true,
        durableSuspend: true,
      },
    ),
    /originating configuration/,
  );
});

it("clears newly accepted optional defaults when the original direct-host selection was unset", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-unset-original-config-"));
  const current = configuredActor(home);
  current.model = undefined;
  current.permissionRuleSetId = undefined;
  current.systemPrompt = undefined;
  current.tools = null;
  current.skills = null;
  const f = buildToolService(home, current);
  t.after(async () => {
    await f.journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const pending = await f.service.requestTool(
    current,
    "subagent_new",
    { name: "Original unset" },
    { forceApproval: true, durableSuspend: true },
  );
  await f.service.projectApprovalDecision(
    {
      toolCallId: pending.toolCall.id,
      ordinal: 0,
      decision: "allow",
      resolutionRequestId: "allow-unset",
    },
    f.journalCommit,
  );
  current.model = { provider: "new-provider", modelId: "new-model" };
  current.permissionRuleSetId = "autonomous";
  current.systemPrompt = "New prompt";
  current.tools = [];
  current.skills = [];
  const restarted = buildToolService(home, current);
  t.after(() => restarted.journal.close());
  await restarted.service.hydrate();
  const restored = getAgentSnapshotForToolCall(
    current,
    await restarted.service.getToolCallDetails(pending.toolCall.id),
  );
  assert.equal(restored.model, undefined);
  assert.equal(restored.permissionRuleSetId, undefined);
  assert.equal(restored.systemPrompt, undefined);
  assert.equal(restored.tools, null);
  assert.equal(restored.skills, null);
});
