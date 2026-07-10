import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePlanReviewRequestSchema } from "../src/index.js";

describe("plan review resolve request schema", () => {
  it("keeps feedback-only requests valid", () => {
    assert.deepEqual(resolvePlanReviewRequestSchema.parse({ feedback: "ok" }), {
      feedback: "ok",
    });
  });

  it("accepts implementation model and thinking selection", () => {
    assert.deepEqual(
      resolvePlanReviewRequestSchema.parse({
        implementationModel: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
        },
        implementationThinkingLevel: "max",
      }),
      {
        implementationModel: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
        },
        implementationThinkingLevel: "max",
      },
    );
  });

  it("rejects invalid thinking levels", () => {
    assert.throws(() =>
      resolvePlanReviewRequestSchema.parse({
        implementationThinkingLevel: "maximum",
      }),
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
  });
});
