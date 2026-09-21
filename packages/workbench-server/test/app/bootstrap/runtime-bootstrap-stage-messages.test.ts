import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RUNTIME_BOOTSTRAP_STAGE_MESSAGES,
  type RuntimeBootstrapStage,
} from "../../../src/app/bootstrap/hydrate-runtime.js";

const ALL_STAGES: RuntimeBootstrapStage[] = [
  "recovering-conversation-deletions",
  "recovering-durable-state",
  "hydrating-read-models",
  "core-ready",
  "failed",
];

/** The splash status line fits roughly this much copy before it truncates. */
const MAX_STATUS_LENGTH = 34;

describe("runtime bootstrap stage messages", () => {
  it("only names known stages and stays silent for a failed bootstrap", () => {
    for (const stage of Object.keys(RUNTIME_BOOTSTRAP_STAGE_MESSAGES))
      assert.ok(
        ALL_STAGES.includes(stage as RuntimeBootstrapStage),
        `unknown stage: ${stage}`,
      );
    assert.equal(RUNTIME_BOOTSTRAP_STAGE_MESSAGES.failed, undefined);
  });

  it("reads as short human sentences that fit the splash status line", () => {
    for (const stage of ALL_STAGES) {
      const message = RUNTIME_BOOTSTRAP_STAGE_MESSAGES[stage];
      if (message === undefined) continue;
      assert.ok(
        message.length <= MAX_STATUS_LENGTH,
        `${stage} message is too long for the splash: ${message}`,
      );
      assert.doesNotMatch(
        message,
        /[:_]|-[a-z]/,
        `${stage} message exposes machine vocabulary: ${message}`,
      );
      assert.match(message, /^[A-Z][a-z]/, `${stage} message: ${message}`);
    }
  });
});
