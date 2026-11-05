import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  approvalKind,
  approvalRequestSchema,
  configurationBlockedKind,
  interactionResolutionSchema,
  interactionSchema,
  planReviewKind,
  planReviewRequestSchema,
  userInputKind,
  userInputRequestSchema,
  type Interaction,
  type InteractionKind,
  type InteractionResolution,
  type InteractionResolutionOf,
} from "../../src/domains/core/tool-call.js";
import type { planReviewResolutionSchema } from "../../src/domains/agent-configuration/agent-configuration-operations.js";
import type {
  ConfigurationBlockedRequest,
  ConfigurationBlockedResolution,
} from "../../src/domains/core/tool-call.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const assertType = <T extends true>(...args: [value?: T]) => void args;

type Envelope<K extends string, Req, Res> = {
  kind: K;
  request: Req;
  resolution?: Res | undefined;
  resolutionRequestId?: string | undefined;
};
type ApprovalResolution = {
  kind: "approval";
  decision: "approve" | "deny";
  persistScope?: "conversation" | "project" | "user" | undefined;
};
type UserInputResolution = z.infer<typeof userInputKind.resolution>;
type PlanResolution = z.infer<typeof planReviewResolutionSchema>;

// The exported types must stay identical to the pre-derivation shapes.
assertType<
  Equal<
    Interaction,
    | Envelope<
        "approval",
        z.infer<typeof approvalRequestSchema>,
        ApprovalResolution
      >
    | Envelope<
        "user_input",
        z.infer<typeof userInputRequestSchema>,
        UserInputResolution
      >
    | Envelope<
        "plan_review",
        z.infer<typeof planReviewRequestSchema>,
        PlanResolution
      >
    | Envelope<
        "configuration_blocked",
        ConfigurationBlockedRequest,
        ConfigurationBlockedResolution
      >
  >
>();
assertType<
  Equal<
    InteractionResolution,
    | ApprovalResolution
    | UserInputResolution
    | PlanResolution
    | ConfigurationBlockedResolution
  >
>();
assertType<Equal<InteractionResolutionOf<"approval">, ApprovalResolution>>();
assertType<Equal<InteractionKind, Interaction["kind"]>>();

test("both unions are built from the same four kind declarations", () => {
  const kinds = [
    approvalKind,
    userInputKind,
    planReviewKind,
    configurationBlockedKind,
  ].map((declaration) => declaration.kind);
  assert.deepEqual(kinds, [
    "approval",
    "user_input",
    "plan_review",
    "configuration_blocked",
  ]);
  assert.deepEqual(
    interactionSchema.options.map((option) => option.shape.kind.value),
    kinds,
  );
  assert.equal(interactionResolutionSchema.options.length, kinds.length);
  for (const declaration of [
    approvalKind,
    userInputKind,
    configurationBlockedKind,
  ])
    assert.ok(
      interactionResolutionSchema.options.includes(
        declaration.resolution as never,
      ),
    );
  assert.ok(
    interactionResolutionSchema.options.includes(
      planReviewKind.resolution as never,
    ),
  );
});

test("each interaction embeds its own kind's resolution schema", () => {
  const wrong = {
    kind: "approval",
    request: { reason: "r", suggestedRules: [] },
    resolution: { kind: "user_input", answers: {} },
  };
  assert.equal(interactionSchema.safeParse(wrong).success, false);
  assert.equal(
    interactionSchema.safeParse({
      ...wrong,
      resolution: { kind: "approval", decision: "approve" },
    }).success,
    true,
  );
});
