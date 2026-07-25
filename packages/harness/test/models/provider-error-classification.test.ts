import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRetryableProviderError } from "../../src/models/provider-error-classification.js";

describe("provider error classification", () => {
  it("retries OpenAI's generic server-side processing failure", () => {
    assert.equal(
      isRetryableProviderError(
        "Codex error: An error occurred while processing your request. You can retry your request, or contact us through our help center if the error persists.",
      ),
      true,
    );
  });

  it("retries known transient provider failures", () => {
    const messages = [
      "provider returned error 500",
      "too many requests (429)",
      "service unavailable 503",
      "network error: fetch failed",
      "connection lost while reading response",
      "websocket closed unexpectedly",
      "stream ended before message_stop",
      "request timed out",
      "provider overloaded",
    ];

    for (const message of messages) {
      assert.equal(isRetryableProviderError(message), true, message);
    }
  });

  it("does not retry permanent failures even with transient wording", () => {
    const messages = [
      "500 insufficient_quota for org",
      "service unavailable because billing must be updated",
      "rate limit: Monthly usage limit reached",
      "internal error: maximum context length exceeded",
      "network error: too many tokens",
    ];

    for (const message of messages) {
      assert.equal(isRetryableProviderError(message), false, message);
    }
  });

  it("does not retry absent or unknown failures", () => {
    assert.equal(isRetryableProviderError(undefined), false);
    assert.equal(isRetryableProviderError("x"), false);
  });
});
