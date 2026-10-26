import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePlanReviewRequestSchema } from "../../src/domains/plans/index.js";
import { planReviewRequestSchema } from "../../src/domains/core/tool-call.js";

describe("plan review resolve request schema", () => {
  it("requires a captured profile target and concurrency tokens in the persisted review request", () => {
    const request = {
      assetId: "asset_plan",
      path: "/plans/plan.md",
      targetProfile: { name: "coding", digest: "a".repeat(64) },
      expectedRevision: 1,
      expectedDigest: "b".repeat(64),
    };
    assert.deepEqual(planReviewRequestSchema.parse(request), request);
    for (const key of [
      "targetProfile",
      "expectedRevision",
      "expectedDigest",
    ] as const) {
      const incomplete: Partial<typeof request> = { ...request };
      delete incomplete[key];
      assert.equal(
        planReviewRequestSchema.safeParse(incomplete).success,
        false,
        key,
      );
    }
    for (const override of [
      { targetProfile: { ...request.targetProfile, name: "../coding" } },
      { targetProfile: { name: "coding" } },
      { targetProfile: { ...request.targetProfile, digest: "invalid" } },
      { expectedRevision: -1 },
      { expectedRevision: 1.5 },
      { expectedDigest: "invalid" },
      { approvalProfile: "coding" },
    ]) {
      assert.equal(
        planReviewRequestSchema.safeParse({ ...request, ...override }).success,
        false,
        JSON.stringify(override),
      );
    }
    assert.ok(
      planReviewRequestSchema.safeParse({
        ...request,
        expectedRevision: 0,
        expectedDigest: "missing",
      }).success,
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
