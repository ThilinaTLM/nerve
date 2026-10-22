import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePlanReviewRequestSchema } from "../../src/domains/plans/index.js";
import { planReviewRequestSchema } from "../../src/domains/core/tool-call.js";

describe("plan review resolve request schema", () => {
  it("requires a captured valid approval profile in the persisted review request", () => {
    const request = { assetId: "asset_plan", path: "/plans/plan.md" };
    assert.equal(planReviewRequestSchema.safeParse(request).success, false);
    assert.equal(
      planReviewRequestSchema.safeParse({
        ...request,
        approvalProfile: "../coding",
      }).success,
      false,
    );
    assert.equal(
      planReviewRequestSchema.parse({ ...request, approvalProfile: "coding" })
        .approvalProfile,
      "coding",
    );
  });
  it("accepts implementation model and thinking selection", () => {
    assert.deepEqual(
      resolvePlanReviewRequestSchema.parse({
        implementationModel: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
        },
        implementationThinkingLevel: "max",
        compactBeforeImplementation: true,
      }),
      {
        implementationModel: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
        },
        implementationThinkingLevel: "max",
        compactBeforeImplementation: true,
      },
    );
  });

  it("rejects empty provider and model ids", () => {
    assert.throws(() =>
      resolvePlanReviewRequestSchema.parse({
        implementationModel: { provider: "", modelId: "claude-sonnet-4-5" },
      }),
    );
    assert.throws(() =>
      resolvePlanReviewRequestSchema.parse({
        implementationModel: { provider: "anthropic", modelId: "" },
      }),
    );
    assert.throws(() =>
      resolvePlanReviewRequestSchema.parse({
        compactBeforeImplementation: "yes",
      }),
    );
  });
});
