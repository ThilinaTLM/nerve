import assert from "node:assert/strict";
import test from "node:test";
import {
  runRecordSchema,
  assertRunInitialInputIdentity,
} from "../../src/domains/runs/run-runtime.js";
import {
  agentAsyncObligationSchema,
  agentAsyncObligationId,
  agentAsyncObligationEntryId,
  assertAgentAsyncObligationReplacement,
} from "../../src/domains/agents/agent-obligation.js";
import { agentHistoryResultSchema } from "../../src/domains/agents/agent-operations.js";

const now = "2026-10-06T00:00:00.000Z";
test("run source input survives storage roundtrip and cannot be retroactively replaced or assigned", () => {
  const base = {
    stateEpoch: 1,
    conversationId: "conv_shared",
    agentId: "agent_child",
    projectId: "proj_test",
    runId: "run_one",
    scopeId: "agent_child",
    revision: 1,
    status: "starting",
    recoverability: "not_needed",
    executionId: "exec_one",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    cancellationEvidence: [],
  };
  const admitted = runRecordSchema.parse({
    ...base,
    initialInputId: "input_origin",
  });
  const resumed = runRecordSchema.parse({
    ...admitted,
    revision: 2,
    executionId: "exec_retry",
    attempt: 2,
  });
  assert.equal(
    runRecordSchema.parse(JSON.parse(JSON.stringify(resumed))).initialInputId,
    "input_origin",
  );
  assert.doesNotThrow(() => assertRunInitialInputIdentity(admitted, resumed));
  assert.throws(
    () =>
      assertRunInitialInputIdentity(admitted, {
        initialInputId: "input_other",
      }),
    /immutable/,
  );
  assert.throws(() => assertRunInitialInputIdentity(admitted, {}), /immutable/);
  const legacy = runRecordSchema.parse(base);
  assert.equal(legacy.initialInputId, undefined);
  assert.doesNotThrow(() =>
    assertRunInitialInputIdentity(legacy, { ...legacy, revision: 2 }),
  );
  assert.throws(
    () => assertRunInitialInputIdentity(legacy, admitted),
    /immutable/,
  );
  assert.equal(
    runRecordSchema.safeParse({
      ...base,
      initialInputId: "promptq_fake_origin",
    }).success,
    false,
  );
});

function obligation(sourceId: string, metadata: Record<string, unknown>) {
  return {
    id: agentAsyncObligationId("user_intervention", sourceId, 0),
    sourceKind: "user_intervention",
    sourceId,
    sourceAgentId: "agent_child",
    ownerAgentId: "agent_parent",
    conversationId: "conv_shared",
    state: "ready",
    generation: 0,
    notificationEntryId: agentAsyncObligationEntryId(
      "user_intervention",
      sourceId,
      0,
    ),
    createdAt: now,
    updatedAt: now,
    outcome: JSON.stringify({ childId: "agent_child", sourceId, ...metadata }),
  };
}

test("intervention origin remains distinct and notices correlate to accepted input/config/control metadata", () => {
  const input = obligation("input_one", {
    action: "submitted input",
    inputId: "input_one",
  });
  const configuration = obligation("configuration:agent_child:2", {
    action: "changed next-turn configuration",
    configurationRevision: 2,
  });
  const control = obligation("control:agent_child:3:paused", {
    action: "paused the agent",
    controlGeneration: 3,
    activationState: "paused",
  });
  for (const value of [input, configuration, control])
    assert.deepEqual(agentAsyncObligationSchema.parse(value), value);
  assert.notEqual(
    input.notificationEntryId,
    agentAsyncObligationEntryId("async_subagent", input.sourceId, 0),
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse({ ...input, sourceAgentId: undefined })
      .success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse({
      ...input,
      sourceAgentId: "agent_parent",
    }).success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse({
      ...input,
      outcome: JSON.stringify({
        action: "submitted input",
        childId: "agent_sibling",
        sourceId: input.sourceId,
        inputId: input.sourceId,
      }),
    }).success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse({
      ...input,
      outcome: "Untrusted child instructions instead of correlation metadata",
    }).success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse(
      obligation("input_one", {
        action: "submitted input",
        inputId: "input_other",
      }),
    ).success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse(
      obligation("configuration:agent_child:2", {
        action: "changed next-turn configuration",
        configurationRevision: 3,
      }),
    ).success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse(
      obligation("control:agent_child:3:paused", {
        action: "resumed the agent",
        controlGeneration: 3,
        activationState: "paused",
      }),
    ).success,
    false,
  );
  assert.equal(
    agentAsyncObligationSchema.safeParse({
      ...input,
      completion: {
        agentId: "agent_child",
        runId: "run_one",
        attemptId: "exec_one",
        completedAt: now,
        outcome: "completed",
      },
    }).success,
    false,
  );
  const parsed = agentAsyncObligationSchema.parse(input);
  assert.throws(
    () =>
      assertAgentAsyncObligationReplacement(parsed, {
        ...parsed,
        sourceAgentId: "agent_sibling",
      }),
    /immutable/,
  );
});

const entry = (id: string, parentEntryId?: string) => ({
  id,
  parentEntryId,
  agentId: "agent_child",
  conversationId: "conv_shared",
  role: "user",
  kind: "message",
  text: id,
  createdAt: now,
});
const history = {
  agentId: "agent_child",
  conversationId: "conv_shared",
  entries: [
    entry("entry_root"),
    entry("entry_current", "entry_root"),
    entry("entry_newer_detached", "entry_root"),
    entry("entry_model_only_old_prefix"),
  ],
  toolCalls: [],
  latestCompletion: null,
  effectiveConfiguration: null,
  cursorSeq: 0,
};

test("owner active path is explicit and unaffected by full-tree order, detached branches or model-only prefix", () => {
  const value = agentHistoryResultSchema.parse({
    ...history,
    activeEntryId: "entry_current",
    activeEntryIds: ["entry_root", "entry_current"],
  });
  assert.equal(value.activeEntryId, "entry_current");
  assert.deepEqual(value.activeEntryIds, ["entry_root", "entry_current"]);
  assert.equal(value.entries.at(-1)?.id, "entry_model_only_old_prefix");
  assert.equal(value.activeEntryIds?.includes("entry_newer_detached"), false);
  // Ancestry can contain non-rendered structural context IDs: do not infer path from display entries.
  assert.equal(
    agentHistoryResultSchema.safeParse({
      ...history,
      activeEntryId: "entry_hidden_model_leaf",
      activeEntryIds: ["entry_root", "entry_hidden_model_leaf"],
    }).success,
    true,
  );
  assert.equal(
    agentHistoryResultSchema.safeParse({ entries: [] }).success,
    false,
  );
  assert.equal(
    agentHistoryResultSchema.safeParse({
      ...history,
      activeEntryId: null,
      activeEntryIds: [],
    }).success,
    true,
  );
  for (const path of [
    { activeEntryId: "entry_current" },
    { activeEntryIds: ["entry_current"] },
    { activeEntryId: null, activeEntryIds: ["entry_current"] },
    {
      activeEntryId: "entry_current",
      activeEntryIds: ["entry_current", "entry_newer_detached"],
    },
    {
      activeEntryId: "entry_current",
      activeEntryIds: ["entry_root", "entry_current", "entry_current"],
    },
  ])
    assert.equal(
      agentHistoryResultSchema.safeParse({ ...history, ...path }).success,
      false,
    );
});

test("existing historical context entry details can retain frozen prefix tool results without mutable foreign records", () => {
  const frozen = {
    ...entry("entry_frozen_tool"),
    role: "system",
    kind: "tool_result",
    text: "Captured old result",
    details: {
      provenance: "historical_context_prefix",
      sourceAgentId: "agent_original",
      contextOwnerAgentId: "agent_child",
      capturedToolResult: { toolName: "read", text: "Old result only" },
    },
  };
  const parsed = agentHistoryResultSchema.parse({
    ...history,
    entries: [frozen],
    activeEntryId: frozen.id,
    activeEntryIds: [frozen.id],
  });
  assert.deepEqual(parsed.entries[0]?.details, frozen.details);
  assert.deepEqual(
    parsed.toolCalls,
    [],
    "no new field or mutable foreign tool lookup is required to preserve captured projection data",
  );
});
