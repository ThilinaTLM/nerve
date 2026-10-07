import assert from "node:assert/strict";
import test from "node:test";
import {
  agentRecordSchema,
  resolveAgentBlueprint,
  updateAgentRequestSchema,
} from "../../src/domains/agents/agent.js";
import {
  acceptAgentInputRequestSchema,
  agentInputRecordSchema,
  agentCompletionSchema,
} from "../../src/domains/agents/agent-blueprint.js";

const now = "2026-10-06T00:00:00.000Z";
const historical = {
  id: "agent_child",
  conversationId: "conv_shared",
  projectId: "proj_test",
  rootAgentId: "agent_root",
  parentAgentId: "agent_root",
  projectDir: "/workspace",
  mode: "coding",
  permissionLevel: "read_only",
  workspaceScope: { roots: ["/workspace"] },
  createdAt: now,
  updatedAt: now,
};

test("historical blueprint migration preserves identity and resolves deterministic independent policies", () => {
  for (const executionKind of ["root", "explore", "async_developer"] as const) {
    const decoded = resolveAgentBlueprint(
      agentRecordSchema.parse({ ...historical, executionKind }),
    );
    assert.equal(decoded.id, historical.id);
    assert.equal(decoded.conversationId, historical.conversationId);
    assert.equal(decoded.configurationRevision, 1);
    assert.equal(decoded.effectiveConfigurationRevision, 0);
    assert.equal(decoded.activationState, "enabled");
    assert.deepEqual(resolveAgentBlueprint(decoded), decoded);
    assert.equal(decoded.readOnlyCeiling, executionKind === "explore");
    assert.equal(
      decoded.orchestrationPolicy?.completionReporting,
      executionKind === "async_developer" ? "parent" : "none",
    );
    const staleKind = resolveAgentBlueprint({
      ...decoded,
      executionKind: "explore",
    });
    assert.deepEqual(
      staleKind.orchestrationPolicy,
      decoded.orchestrationPolicy,
    );
    assert.equal(staleKind.readOnlyCeiling, decoded.readOnlyCeiling);
  }
});

test("historical decoding preserves explicit custom reporting policies and context bindings", () => {
  for (const completionReporting of ["none", "parent"] as const) {
    for (const contextOwnerAgentId of [null, historical.id]) {
      const record = agentRecordSchema.parse({
        ...historical,
        executionKind: "explore",
        contextOwnerAgentId,
        orchestrationPolicy: {
          preset: "explore",
          parentCancellation: "attached",
          completionReporting,
        },
      });
      const decoded = resolveAgentBlueprint(record);
      assert.deepEqual(decoded.orchestrationPolicy, record.orchestrationPolicy);
      assert.equal(decoded.contextOwnerAgentId, contextOwnerAgentId);
      assert.equal(decoded.id, record.id);
      assert.equal(decoded.conversationId, record.conversationId);
      assert.deepEqual(resolveAgentBlueprint(decoded), decoded);
    }
  }
});

const request = {
  agentId: "agent_child",
  conversationId: "conv_shared",
  idempotencyKey: "request-1",
  origin: { kind: "user", userId: "authorized-user" },
  role: "user",
  text: "Next turn",
};
test("input contracts reject role spoofing and preserve explicit eligibility and activation independently of role", () => {
  assert.equal(
    acceptAgentInputRequestSchema.safeParse({ ...request, role: "system" })
      .success,
    false,
  );
  assert.equal(
    acceptAgentInputRequestSchema.safeParse({
      ...request,
      origin: { kind: "parent", agentId: "agent_root" },
      role: "system",
    }).success,
    false,
  );
  const accepted = acceptAgentInputRequestSchema.parse(request);
  assert.deepEqual(accepted.eligibility, { kind: "next_turn" });
  assert.equal(accepted.activation, "wake_if_idle");
  const notification = acceptAgentInputRequestSchema.parse({
    ...request,
    role: "system",
    origin: {
      kind: "system",
      producer: "task-settlement",
      correlationId: "task_1",
    },
    activation: "queue_only",
    eligibility: { kind: "next_run", afterRunId: "run_old" },
  });
  assert.equal(notification.activation, "queue_only");
  assert.equal(notification.eligibility.kind, "next_run");
});

test("delivery cannot lose its insertion identity or retarget a settled run", () => {
  const pending = {
    ...request,
    id: "input_1",
    sequence: 0,
    acceptedAt: now,
    state: "pending",
    eligibility: { kind: "run", runId: "run_original" },
  };
  assert.equal(agentInputRecordSchema.safeParse(pending).success, true);
  assert.equal(
    agentInputRecordSchema.safeParse({ ...pending, state: "delivered" })
      .success,
    false,
  );
  const delivery = {
    runId: "run_other",
    attemptId: "exec_1",
    turnId: "turn_1",
    contextEntryId: "entry_1",
    deliveredAt: now,
  };
  assert.equal(
    agentInputRecordSchema.safeParse({
      ...pending,
      state: "delivered",
      delivery,
    }).success,
    false,
  );
  assert.equal(
    agentInputRecordSchema.safeParse({
      ...pending,
      state: "delivered",
      delivery: { ...delivery, runId: "run_original" },
    }).success,
    true,
  );
  assert.equal(
    agentInputRecordSchema.safeParse({
      ...pending,
      state: "cancelled",
      delivery,
    }).success,
    false,
  );
});

test("completion binds response to the exact submitted run", () => {
  const completion = {
    agentId: "agent_child",
    runId: "run_original",
    attemptId: "exec_1",
    outcome: "completed",
    completedAt: now,
    response: {
      entryId: "entry_1",
      runId: "run_new",
      text: "Wrong assignment",
      complete: true,
    },
  };
  assert.equal(agentCompletionSchema.safeParse(completion).success, false);
  assert.equal(
    agentCompletionSchema.safeParse({
      ...completion,
      response: { ...completion.response, runId: "run_original" },
    }).success,
    true,
  );
});

test("configuration updates carry every mutable field without implicitly defaulting omitted settings", () => {
  assert.deepEqual(updateAgentRequestSchema.parse({ mode: "planning" }), {
    mode: "planning",
  });
  assert.deepEqual(
    updateAgentRequestSchema.parse({
      tools: [],
      skills: ["review"],
      instructions: "Read carefully",
      systemPrompt: null,
    }),
    {
      tools: [],
      skills: ["review"],
      instructions: "Read carefully",
      systemPrompt: null,
    },
  );
});

test("configured tool availability permits interaction and delegation without parentage-wide exclusions", async () => {
  const { isAgentToolConfigured } =
    await import("../../src/domains/agents/agent.js");
  assert.equal(isAgentToolConfigured({ tools: null }, "ask_user"), true);
  assert.equal(
    isAgentToolConfigured(
      { tools: ["ask_user", "subagent_new"] },
      "subagent_new",
    ),
    true,
  );
  assert.equal(isAgentToolConfigured({ tools: [] }, "read_file"), false);
});

test("completion obligation correlation and queue insertion identity cannot be rewritten on replay", async () => {
  const { agentAsyncObligationSchema, assertAgentAsyncObligationReplacement } =
    await import("../../src/domains/agents/agent-obligation.js");
  const completion = {
    agentId: "agent_child",
    runId: "run_original",
    attemptId: "exec_1",
    outcome: "completed",
    completedAt: now,
  };
  const obligation = agentAsyncObligationSchema.parse({
    id: "async_subagent:run_original:0",
    conversationId: "conv_shared",
    ownerAgentId: "agent_parent",
    sourceKind: "async_subagent",
    sourceId: "run_original",
    sourceAgentId: "agent_child",
    state: "ready",
    notificationEntryId: "entry_notice",
    generation: 0,
    createdAt: now,
    updatedAt: now,
    completion,
    queueInputId: "input_notice",
  });
  assert.equal(
    agentAsyncObligationSchema.safeParse({
      ...obligation,
      completion: { ...completion, runId: "run_new" },
    }).success,
    false,
  );
  assert.throws(
    () =>
      assertAgentAsyncObligationReplacement(obligation, {
        ...obligation,
        completion: { ...completion, attemptId: "exec_new" },
      }),
    /completion changed/,
  );
  assert.throws(
    () =>
      assertAgentAsyncObligationReplacement(obligation, {
        ...obligation,
        queueInputId: "input_other",
      }),
    /input identity changed/,
  );
});

test("skill migration distinguishes missing inheritance from explicit empty selection", () => {
  assert.equal(
    resolveAgentBlueprint(agentRecordSchema.parse(historical)).skills,
    null,
  );
  assert.deepEqual(
    resolveAgentBlueprint(
      agentRecordSchema.parse({ ...historical, skills: [] }),
    ).skills,
    [],
  );
  assert.deepEqual(updateAgentRequestSchema.parse({ skills: null }), {
    skills: null,
  });
});

test("resolved turn provenance requires actual settings while legacy accepted-only snapshots stay explicitly labeled", async () => {
  const { effectiveTurnConfigurationSchema } =
    await import("../../src/domains/agents/agent-blueprint.js");
  const raw = {
    ...historical,
    thinkingLevel: "off",
    tools: null,
    skills: null,
  };
  const identity = {
    agentId: historical.id,
    runId: "run_1",
    attemptId: "exec_1",
    turnId: "turn_1",
    configurationRevision: 1,
  };
  const legacy = effectiveTurnConfigurationSchema.parse({
    ...identity,
    configuration: raw,
  });
  assert.equal(legacy.configurationProvenance, "legacy_accepted");
  assert.equal(
    effectiveTurnConfigurationSchema.safeParse({
      ...identity,
      configurationProvenance: "resolved",
      acceptedConfiguration: raw,
      configuration: raw,
    }).success,
    false,
  );
  const resolved = effectiveTurnConfigurationSchema.parse({
    ...identity,
    configurationProvenance: "resolved",
    acceptedConfiguration: raw,
    configuration: {
      ...raw,
      model: { provider: "provider", modelId: "actual-model" },
      tools: ["read_file"],
      skills: ["review"],
      systemPrompt: "Composed prompt",
      permissionRuleSetId: "read_only",
    },
  });
  assert.equal(resolved.configurationProvenance, "resolved");
  assert.deepEqual(resolved.configuration.tools, ["read_file"]);
  if (resolved.configurationProvenance === "resolved")
    assert.equal(resolved.acceptedConfiguration.tools, null);
});

test("completion preserves actual terminal and original submitted attempt with immutable report metadata", async () => {
  const completion = agentCompletionSchema.parse({
    agentId: "agent_child",
    runId: "run_original",
    attemptId: "exec_retry",
    submittedAttemptId: "exec_submitted",
    outcome: "completed",
    completedAt: now,
    usage: { input: 12, output: 3, turns: 2 },
    model: "Actual model",
    modelSelection: { provider: "provider", modelId: "actual" },
    thinkingLevel: "high",
    steps: [{ type: "assistant", message: "Done", timestamp: now }],
  });
  assert.equal(completion.attemptId, "exec_retry");
  assert.equal(completion.submittedAttemptId, "exec_submitted");
  assert.equal(completion.usage?.turns, 2);
  const { promptRequestSchema } =
    await import("../../src/domains/agents/prompt.js");
  const { runSteerParamsSchema } =
    await import("../../src/domains/agents/run-operations.js");
  assert.equal(
    promptRequestSchema.parse({ text: "Retry", idempotencyKey: "caller-42" })
      .idempotencyKey,
    "caller-42",
  );
  assert.equal(
    runSteerParamsSchema.parse({
      agentId: "agent_child",
      text: "Retry",
      idempotencyKey: "caller-42",
    }).idempotencyKey,
    "caller-42",
  );
});

test("correlated completion report metadata is immutable after settlement", async () => {
  const { assertAgentCompletionReplacement } =
    await import("../../src/domains/agents/agent-blueprint.js");
  const completion = agentCompletionSchema.parse({
    agentId: "agent_child",
    runId: "run_original",
    attemptId: "exec_final",
    submittedAttemptId: "exec_first",
    outcome: "completed",
    completedAt: now,
    usage: { turns: 2 },
    model: "Original model",
  });
  assert.doesNotThrow(() =>
    assertAgentCompletionReplacement(completion, { ...completion }),
  );
  assert.throws(
    () =>
      assertAgentCompletionReplacement(completion, {
        ...completion,
        model: "Latest mutable model",
      }),
    /immutable/,
  );
  assert.throws(
    () =>
      assertAgentCompletionReplacement(completion, {
        ...completion,
        attemptId: "exec_first",
      }),
    /immutable/,
  );
});

test("public queue operations preserve generalized input provenance and real identity alongside historical records", async () => {
  const {
    agentsOperationDefinitions,
    agentPromptQueueListResultSchema,
    agentPromptQueueCancelResultSchema,
  } = await import("../../src/domains/agents/agent-operations.js");
  const input = agentInputRecordSchema.parse({
    ...request,
    id: "input_real",
    sequence: 4,
    acceptedAt: now,
    state: "pending",
    activation: "queue_only",
    eligibility: { kind: "next_run", afterRunId: "run_1" },
  });
  const listed = agentPromptQueueListResultSchema.parse({
    queuedPrompts: [input],
  });
  assert.deepEqual(listed.queuedPrompts, [input]);
  assert.equal("status" in listed.queuedPrompts[0]!, false);
  assert.equal("projectId" in listed.queuedPrompts[0]!, false);
  const cancelled = agentPromptQueueCancelResultSchema.parse({
    queuedPrompt: { ...input, state: "cancelled" },
  });
  assert.equal(cancelled.queuedPrompt.id, "input_real");
  assert.deepEqual(
    "origin" in cancelled.queuedPrompt && cancelled.queuedPrompt.origin,
    input.origin,
  );
  const cancelOperation = agentsOperationDefinitions.find(
    (operation) => operation.method === "agent.promptQueue.cancel",
  );
  assert.ok(cancelOperation);
  // Operation validation must accept actual generalized identities and retain the old key name.
  assert.equal(
    cancelOperation.paramsSchema.safeParse({
      agentId: "agent_child",
      queuedPromptId: "input_real",
    }).success,
    true,
  );
  assert.equal(
    cancelOperation.paramsSchema.safeParse({
      agentId: "agent_child",
      queuedPromptId: "promptq_historical",
    }).success,
    true,
  );
  const legacy = {
    id: "promptq_historical",
    agentId: "agent_child",
    conversationId: "conv_shared",
    projectId: "proj_test",
    behavior: "follow-up",
    text: "Old accepted input",
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(
    agentPromptQueueListResultSchema.safeParse({
      queuedPrompts: [input, legacy],
    }).success,
    true,
  );
});

test("scoped history result retains exact completion and resolved turn data while old entries-only responses remain readable", async () => {
  const { agentHistoryResultSchema } =
    await import("../../src/domains/agents/agent-operations.js");
  const snapshot = {
    agentId: "agent_child",
    runId: "run_1",
    attemptId: "exec_final",
    turnId: "turn_1",
    configurationRevision: 1,
    configuration: { ...historical, thinkingLevel: "off" },
  };
  const completion = {
    agentId: "agent_child",
    runId: "run_1",
    attemptId: "exec_final",
    submittedAttemptId: "exec_first",
    outcome: "completed",
    completedAt: now,
  };
  const complete = agentHistoryResultSchema.parse({
    entries: [],
    agentId: "agent_child",
    conversationId: "conv_shared",
    toolCalls: [],
    latestCompletion: completion,
    effectiveConfiguration: snapshot,
  });
  assert.deepEqual(complete.toolCalls, []);
  assert.equal(complete.latestCompletion?.attemptId, "exec_final");
  assert.equal(complete.effectiveConfiguration?.configurationRevision, 1);
  assert.deepEqual(agentHistoryResultSchema.parse({ entries: [] }), {
    entries: [],
  });
});

test("public create/update do not accept internal parent authority snapshots", async () => {
  const { createAgentRequestSchema } =
    await import("../../src/domains/agents/agent.js");
  const spoof = {
    agentId: "agent_root",
    configurationRevision: 99,
    configuration: historical,
    source: {
      runId: "run_fake",
      attemptId: "exec_fake",
      toolCallId: "tool_fake",
    },
  };
  assert.equal(
    "parentConfigurationSnapshot" in
      createAgentRequestSchema.parse({
        conversationId: "conv_shared",
        projectId: "proj_test",
        parentConfigurationSnapshot: spoof,
      }),
    false,
  );
  assert.equal(
    "parentConfigurationSnapshot" in
      updateAgentRequestSchema.parse({
        instructions: "Ordinary user edit",
        parentConfigurationSnapshot: spoof,
      }),
    false,
  );
});

test("complete scoped history producers cannot omit queue/runtime state or return another agent's completion", async () => {
  const { completeAgentHistoryResultSchema } =
    await import("../../src/domains/agents/agent-operations.js");
  assert.equal(
    completeAgentHistoryResultSchema.safeParse({ entries: [] }).success,
    false,
  );
  const history = {
    agentId: "agent_child",
    conversationId: "conv_shared",
    entries: [],
    toolCalls: [],
    latestCompletion: null,
    effectiveConfiguration: null,
  };
  assert.equal(
    completeAgentHistoryResultSchema.safeParse(history).success,
    true,
  );
  assert.equal(
    completeAgentHistoryResultSchema.safeParse({
      ...history,
      latestCompletion: {
        agentId: "agent_sibling",
        runId: "run_other",
        attemptId: "exec_other",
        outcome: "completed",
        completedAt: now,
      },
    }).success,
    false,
  );
});
