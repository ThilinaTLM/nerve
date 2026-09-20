import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRunFailure } from "../../src/domains/runs/run-failure.js";

describe("run failure normalization", () => {
  it("extracts a rate-limit message from a status-prefixed provider payload", () => {
    const failure = normalizeRunFailure(
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_secret"}',
      "provider",
    );

    assert.deepEqual(failure, {
      message:
        "This request would exceed your account's rate limit. Please try again later.",
      category: "rate_limit",
      httpStatus: 429,
    });
    assert.doesNotMatch(failure.message, /request_id|req_secret/);
  });

  it("classifies authentication, connection, provider, and harness failures", () => {
    assert.equal(
      normalizeRunFailure("401 Unauthorized", "provider").category,
      "authentication",
    );
    assert.equal(
      normalizeRunFailure("fetch failed: connection timed out", "provider")
        .category,
      "connection",
    );
    assert.equal(
      normalizeRunFailure("Provider rejected the request", "provider").category,
      "provider",
    );
    assert.equal(
      normalizeRunFailure(new Error("Hook failed"), "harness").category,
      "harness",
    );
  });

  it("keeps malformed and unknown failures readable", () => {
    assert.deepEqual(normalizeRunFailure('503 {"error":', "provider"), {
      message: '503 {"error":',
      category: "provider",
      httpStatus: 503,
    });
    assert.deepEqual(normalizeRunFailure("plain failure"), {
      message: "plain failure",
      category: "unknown",
    });
  });
});
