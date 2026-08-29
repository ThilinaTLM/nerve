import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePlanReviewRequestSchema } from "../../src/index.js";

describe("plan review resolve request schema", () => {
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
