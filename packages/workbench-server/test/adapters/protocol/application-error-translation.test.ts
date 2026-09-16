import assert from "node:assert/strict";
import test from "node:test";
import { translateApplicationError } from "../../../src/adapters/protocol/application-error-translation.js";
import { ApplicationError } from "../../../src/core/application-error.js";

test("translates a busy agent application error into a non-retryable conflict", () => {
  const translated = translateApplicationError(
    new ApplicationError(409, "AGENT_BUSY", "Agent is already running."),
  );

  assert.deepEqual(translated, {
    code: "CONFLICT",
    message: "Agent is already running.",
    retryable: false,
  });
});

test("preserves an explicit application retryability decision", () => {
  const translated = translateApplicationError(
    new ApplicationError(409, "LEASE_CONFLICT", "Try again.", {
      retryable: true,
    }),
  );

  assert.equal(translated.code, "CONFLICT");
  assert.equal(translated.retryable, true);
});
