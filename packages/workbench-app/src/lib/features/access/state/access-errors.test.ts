import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError } from "$lib/platform/http/api-client";
import { describeAccessError, formatRetryAfter } from "./access-errors";

test("rate limiting reports the wait", () => {
  const error = new ApiRequestError(429, "RATE_LIMITED", "slow down", 120);
  assert.match(describeAccessError(error), /2 minutes/);
  assert.match(
    describeAccessError(new ApiRequestError(429, "RATE_LIMITED", "x")),
    /Wait a little/,
  );
});

test("known codes map to guidance", () => {
  assert.match(
    describeAccessError(new ApiRequestError(403, "TLS_REQUIRED", "x")),
    /HTTPS/,
  );
  assert.match(
    describeAccessError(new ApiRequestError(400, "PAIRING_CODE_INVALID", "x")),
    /expired/,
  );
  assert.match(
    describeAccessError(
      new ApiRequestError(409, "PASSKEY_LAST_REMAINING", "x"),
    ),
    /only passkey/,
  );
});

test("unknown codes fall back to the server message; cancelled prompts are friendly", () => {
  assert.equal(
    describeAccessError(new ApiRequestError(500, "WHAT", "server said")),
    "server said",
  );
  const abort = Object.assign(new Error("x"), { name: "NotAllowedError" });
  assert.match(describeAccessError(abort), /cancelled/);
});

test("retry-after formatting", () => {
  assert.equal(formatRetryAfter(30), "30 seconds");
  assert.equal(formatRetryAfter(60), "60 seconds");
  assert.equal(formatRetryAfter(600), "10 minutes");
});
