import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interactionSchema,
  toolCallResponsePayloadSchema,
} from "@nervekit/contracts/core";
import {
  planMetadata,
  eventConfirmationReason,
  callConfirmationReason,
  requestBindingReason,
} from "./released-metadata.js";
import { sha256 } from "./released-format.js";
import profiles from "./converted-mode-profiles.json" with { type: "json" };

const request = { assetId: "asset", path: "plans/example.md", title: "Plan" };
function response(id: string, resolution: unknown, args = {}) {
  return {
    toolCallId: id,
    providerCallId: null,
    toolName: "plan_present",
    arguments: args,
    origin: "user",
    assistantEventId: null,
    contentIndex: null,
    outcome: "completed",
    agentProjection: [],
    userProjection: { argsPreview: {}, resultPreview: null },
    supervision: null,
    interactionResolution: resolution,
    resolutionRequestId: "request",
    assetIds: [],
  };
}

void test("planning tool names and review requests produce source-bound DML, not prose replacement", () => {
  const payload = JSON.stringify({
    toolName: "plan_mode_present",
    content: [{ type: "text", text: "plan_mode_present" }],
  });
  const interaction = JSON.stringify({ kind: "plan_review", request });
  const patches = planMetadata({
    events: [{ id: "event", payload }],
    calls: [{ id: "call", toolName: "plan_mode_present", interaction }],
  });
  assert.equal(patches.length, 3);
  assert.equal(patches[0].beforeDigest, sha256(payload));
  assert.equal(
    JSON.parse(patches[0].after).content[0].text,
    "plan_mode_present",
  );
  assert.equal(patches[1].column, "tool_name");
  assert.equal(patches[2].beforeDigest, sha256(interaction));
  const converted = interactionSchema.parse(JSON.parse(patches[2].after));
  assert.equal(converted.kind, "plan_review");
  if (converted.kind !== "plan_review") return;
  assert.deepEqual(converted.request.targetProfile, {
    name: "coding",
    digest: sha256(profiles.coding),
  });
  assert.deepEqual(patches[2].reasons, [requestBindingReason]);
  assert.deepEqual(
    planMetadata({
      events: [],
      calls: [
        { id: "call", toolName: "plan_present", interaction: patches[2].after },
      ],
    }),
    [],
  );
});

void test("approve confirmations in both storage columns match the migrated request, not argument defaults", () => {
  const resolution = {
    kind: "plan_review",
    decision: "approve",
    feedback: "Proceed",
  };
  const interaction = JSON.stringify({
    kind: "plan_review",
    request: {
      ...request,
      approvalProfile: "planning",
      expectedRevision: 7,
      expectedDigest: "a".repeat(64),
    },
    resolution,
    resolutionRequestId: "r",
  });
  const payload = JSON.stringify(
    response("call", resolution, { approvalProfile: "coding" }),
  );
  const patches = planMetadata({
    events: [{ id: "event", payload }],
    calls: [{ id: "call", toolName: "plan_present", interaction }],
  });
  const event = toolCallResponsePayloadSchema.parse(
    JSON.parse(patches[0].after),
  );
  const call = interactionSchema.parse(JSON.parse(patches[1].after));
  assert.equal(call.kind, "plan_review");
  assert.equal(event.interactionResolution?.kind, "plan_review");
  if (
    call.kind !== "plan_review" ||
    call.resolution?.decision !== "approve" ||
    event.interactionResolution?.kind !== "plan_review" ||
    event.interactionResolution.decision !== "approve"
  )
    return;
  const confirmation = call.resolution.confirmation;
  assert.deepEqual(confirmation, event.interactionResolution.confirmation);
  assert.deepEqual(confirmation.targetProfile, {
    name: "planning",
    digest: sha256(profiles.planning),
  });
  assert.deepEqual(confirmation.targetProfile, call.request.targetProfile);
  assert.equal(confirmation.expectedRevision, 7);
  assert.equal(confirmation.expectedDigest, "a".repeat(64));
  assert.match(confirmation.transitionId, /^migration:0002-plan-review:/);
  assert.equal(call.resolution.feedback, "Proceed");
  assert.deepEqual(patches[0].reasons, [eventConfirmationReason]);
  assert.deepEqual(patches[1].reasons, [
    requestBindingReason,
    callConfirmationReason,
  ]);
  assert.equal(patches[0].beforeDigest, sha256(payload));
  assert.equal(patches[1].beforeDigest, sha256(interaction));
  assert.deepEqual(
    planMetadata({
      events: [{ id: "event", payload: patches[0].after }],
      calls: [
        { id: "call", toolName: "plan_present", interaction: patches[1].after },
      ],
    }),
    [],
  );
});

void test("settled events without live calls use the released default and leave rejections/current confirmations unchanged", () => {
  const payload = JSON.stringify(
    response("settled", { kind: "plan_review", decision: "approve" }),
  );
  const rejected = JSON.stringify(
    response("rejected", {
      kind: "plan_review",
      decision: "reject",
      feedback: "Revise",
    }),
  );
  const patches = planMetadata({
    events: [
      { id: "approved", payload },
      { id: "rejected", payload: rejected },
    ],
    calls: [],
  });
  assert.equal(patches.length, 1);
  const converted = toolCallResponsePayloadSchema.parse(
    JSON.parse(patches[0].after),
  );
  assert.equal(converted.interactionResolution?.kind, "plan_review");
  if (
    converted.interactionResolution?.kind !== "plan_review" ||
    converted.interactionResolution.decision !== "approve"
  )
    return;
  assert.equal(
    converted.interactionResolution.confirmation.targetProfile.name,
    "coding",
  );
  assert.deepEqual(
    planMetadata({
      events: [
        { id: "approved", payload: patches[0].after },
        { id: "rejected", payload: rejected },
      ],
      calls: [],
    }),
    [],
  );
});

void test("captured current targets and confirmations retain their digests, transition IDs and explicit choices", () => {
  const confirmation = {
    targetProfile: { name: "reviewer", digest: "b".repeat(64) },
    expectedRevision: 2,
    expectedDigest: "missing",
    transitionId: "original-transition",
    choices: {},
  };
  const payload = JSON.stringify(
    response("call", {
      kind: "plan_review",
      decision: "approve",
      confirmation,
    }),
  );
  const interaction = JSON.stringify({
    kind: "plan_review",
    request: {
      ...request,
      ...confirmation,
      transitionId: undefined,
      choices: undefined,
    },
    resolution: { kind: "plan_review", decision: "approve", confirmation },
  });
  assert.deepEqual(
    planMetadata({
      events: [{ id: "event", payload }],
      calls: [{ id: "call", toolName: "plan_present", interaction }],
    }),
    [],
  );
});

void test("authored legacy approval-profile names are retained without reading project definitions", () => {
  for (const approvalProfile of ["reviewer", "constructor"]) {
    const interaction = JSON.stringify({
      kind: "plan_review",
      request: { ...request, approvalProfile },
      resolution: { kind: "plan_review", decision: "approve" },
    });
    const [patch] = planMetadata({
      events: [],
      calls: [{ id: "authored", toolName: "plan_present", interaction }],
    });
    const converted = interactionSchema.parse(JSON.parse(patch.after));
    assert.equal(converted.kind, "plan_review");
    if (
      converted.kind !== "plan_review" ||
      converted.resolution?.decision !== "approve"
    )
      return;
    assert.equal(converted.request.targetProfile.name, approvalProfile);
    assert.deepEqual(
      converted.resolution.confirmation.targetProfile,
      converted.request.targetProfile,
    );
    assert.equal(
      converted.request.targetProfile.digest,
      sha256(`historical-plan-review-profile:${approvalProfile}`),
    );
  }
});
