import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configurationBlockedInteractionSchema,
  configurationBlockedRequestSchema,
  configurationBlockedResolutionSchema,
  interactionResolutionSchema,
  supervisionSchema,
  toolAdmissionEvidenceSchema,
  toolApprovalBindingMatches,
  toolApprovalBindingSchema,
  toolCallSchema,
  type ToolApprovalBinding,
  type ToolCall,
} from "../../src/domains/core/tool-call.js";
import { resolveInteractionRequestSchema } from "../../src/domains/core/core-operations.js";

const binding: ToolApprovalBinding = {
  toolCallId: "call-1",
  toolName: "bash",
  argumentsDigest: "a".repeat(64),
  executionTargetDigest: "b".repeat(64),
  policyAuthorityDigest: "c".repeat(64),
};
const supervision = {
  decision: "approval" as const,
  suggestedRules: [],
  authority: { ruleSetId: "planning" },
  approval: binding,
};
const request = {
  diagnostics: [
    {
      scope: "project" as const,
      scopeId: "project-1",
      document: "permissions",
      path: "/project/.nerve/config/permissions.json",
      code: "invalid-document",
      pointer: "/ruleSets/planning",
      affectedCapability: "tool-execution",
      recoveryChoices: ["reload" as const, "repair" as const],
    },
  ],
};
const blocked = { kind: "configuration_blocked" as const, request };
const call: ToolCall = {
  id: binding.toolCallId,
  conversationId: "conversation-1",
  turnId: "turn-1",
  providerCallId: null,
  assistantEventId: null,
  contentIndex: null,
  origin: "user",
  toolName: binding.toolName,
  arguments: { command: "pwd" },
  state: "awaiting_input",
  supervision: null,
  interaction: blocked,
  executionClaim: null,
  updatedAt: "2026-10-23T00:00:00.000Z",
};

void test("approval bindings persist all target/argument/authority digests without defaults or raw executor settings", () => {
  assert.deepEqual(supervisionSchema.parse(supervision), supervision);
  assert.deepEqual(toolApprovalBindingSchema.parse(binding), binding);
  for (const key of Object.keys(binding)) {
    const missing = { ...binding } as Record<string, unknown>;
    delete missing[key];
    assert.equal(
      toolApprovalBindingSchema.safeParse(missing).success,
      false,
      key,
    );
  }
  for (const digest of ["", "not-a-digest", "A".repeat(64), "a".repeat(63)]) {
    for (const key of [
      "argumentsDigest",
      "executionTargetDigest",
      "policyAuthorityDigest",
    ]) {
      assert.equal(
        toolApprovalBindingSchema.safeParse({ ...binding, [key]: digest })
          .success,
        false,
        key,
      );
    }
  }
  for (const extra of [
    { credentials: { token: "secret" } },
    { interpreterPath: "/python" },
    { arguments: { command: "pwd" } },
  ]) {
    assert.equal(
      toolApprovalBindingSchema.safeParse({ ...binding, ...extra }).success,
      false,
    );
  }
  assert.equal(
    supervisionSchema.safeParse({ ...supervision, executorCapture: {} })
      .success,
    false,
  );
});

void test("a grant is invalidated by any changed call, tool, normalized arguments, execution target or authority", () => {
  assert.equal(toolApprovalBindingMatches(undefined, binding), false);
  assert.equal(toolApprovalBindingMatches(binding, { ...binding }), true);
  for (const key of Object.keys(binding) as (keyof ToolApprovalBinding)[]) {
    const replacement = key.endsWith("Digest") ? "d".repeat(64) : "different";
    assert.equal(
      toolApprovalBindingMatches(binding, { ...binding, [key]: replacement }),
      false,
      key,
    );
  }
  // Structurally valid evidence cannot be attached to a different call/tool.
  const ordinary = {
    ...call,
    interaction: null,
    state: "awaiting_approval" as const,
    supervision,
  };
  assert.deepEqual(toolCallSchema.parse(ordinary), ordinary);
  for (const changed of [{ id: "different" }, { toolName: "python_exec" }]) {
    assert.equal(
      toolCallSchema.safeParse({ ...ordinary, ...changed }).success,
      false,
    );
  }
});

void test("transient admission evidence has strict, safe process-local generation vectors", () => {
  const evidence = {
    binding,
    requestGenerations: {
      "agent:conversation-1": 2,
      "accounts:user": 4,
      "trust:project-1": 1,
    },
    policyGenerations: { "permissions:project-1": 3 },
  };
  assert.deepEqual(toolAdmissionEvidenceSchema.parse(evidence), evidence);
  for (const generation of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "2"]) {
    assert.equal(
      toolAdmissionEvidenceSchema.safeParse({
        ...evidence,
        policyGenerations: { permissions: generation },
      }).success,
      false,
    );
  }
  for (const extra of [{ executorCapture: {} }, { apiKey: "secret" }])
    assert.equal(
      toolAdmissionEvidenceSchema.safeParse({ ...evidence, ...extra }).success,
      false,
    );
  assert.equal(
    toolAdmissionEvidenceSchema.safeParse({
      ...evidence,
      requestGenerations: { "": 1 },
    }).success,
    false,
  );
  const missing = { binding, requestGenerations: evidence.requestGenerations };
  assert.equal(toolAdmissionEvidenceSchema.safeParse(missing).success, false);
});

void test("configuration blocking identifies failing documents and cannot offer approval or timeout", () => {
  assert.deepEqual(configurationBlockedRequestSchema.parse(request), request);
  assert.deepEqual(
    configurationBlockedInteractionSchema.parse(blocked),
    blocked,
  );
  assert.equal(
    configurationBlockedRequestSchema.safeParse({ diagnostics: [] }).success,
    false,
  );
  const diagnostic = request.diagnostics[0];
  const missingDocument = { ...diagnostic, document: undefined };
  assert.equal(
    configurationBlockedRequestSchema.safeParse({
      diagnostics: [missingDocument],
    }).success,
    false,
  );
  assert.equal(
    configurationBlockedRequestSchema.safeParse({
      diagnostics: [{ ...diagnostic, secret: "secret" }],
    }).success,
    false,
  );
  for (const extra of [{ approval: true }, { timeoutMs: 1000 }])
    assert.equal(
      configurationBlockedInteractionSchema.safeParse({ ...blocked, ...extra })
        .success,
      false,
    );
});

void test("the existing interaction.resolve command accepts only retry/cancel for configuration blocking", () => {
  for (const decision of ["retry", "cancel"] as const) {
    const resolution = { kind: "configuration_blocked" as const, decision };
    const command = {
      toolCallId: call.id,
      resolutionRequestId: "resolution-1",
      resolution,
    };
    assert.deepEqual(resolveInteractionRequestSchema.parse(command), command);
    assert.deepEqual(interactionResolutionSchema.parse(resolution), resolution);
    assert.deepEqual(
      configurationBlockedInteractionSchema.parse({
        ...blocked,
        resolution,
        resolutionRequestId: "resolution-1",
      }),
      { ...blocked, resolution, resolutionRequestId: "resolution-1" },
    );
    assert.equal(
      resolveInteractionRequestSchema.safeParse({
        ...command,
        approval: binding,
      }).success,
      false,
    );
    assert.equal(
      configurationBlockedResolutionSchema.safeParse({
        ...resolution,
        persistScope: "user",
      }).success,
      false,
    );
  }
  for (const decision of ["approve", "deny", "allow"])
    assert.equal(
      configurationBlockedResolutionSchema.safeParse({
        kind: "configuration_blocked",
        decision,
      }).success,
      false,
    );
  assert.equal(
    configurationBlockedInteractionSchema.safeParse({
      ...blocked,
      resolution: { kind: "approval", decision: "approve" },
    }).success,
    false,
  );
});

void test("configuration blocking reuses awaiting_input, with retry receipts allowed during readmission", () => {
  assert.deepEqual(toolCallSchema.parse(call), call);
  for (const state of [
    "supervising",
    "awaiting_approval",
    "ready",
    "running",
  ] as const)
    assert.equal(
      toolCallSchema.safeParse({ ...call, state }).success,
      false,
      state,
    );
  const readmitting = {
    ...call,
    state: "supervising",
    interaction: {
      ...blocked,
      resolution: { kind: "configuration_blocked", decision: "retry" },
      resolutionRequestId: "resolution-1",
    },
  };
  assert.deepEqual(toolCallSchema.parse(readmitting), readmitting);
});
