import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfter } from "./api-client";
import {
  isSessionLostResponse,
  notifyUnauthorized,
  onUnauthorized,
} from "./unauthorized-signal";

test("only credential loss counts as a lost session", () => {
  assert.equal(isSessionLostResponse(401, "UNAUTHORIZED"), true);
  assert.equal(isSessionLostResponse(401, undefined), true);
  assert.equal(
    isSessionLostResponse(401, "PASSKEY_VERIFICATION_FAILED"),
    false,
  );
  assert.equal(isSessionLostResponse(403, "TLS_REQUIRED"), false);
});

test("listeners are notified until they unsubscribe", () => {
  let calls = 0;
  const stop = onUnauthorized(() => void (calls += 1));
  notifyUnauthorized();
  stop();
  notifyUnauthorized();
  assert.equal(calls, 1);
});

test("parses Retry-After seconds", () => {
  assert.equal(parseRetryAfter("42"), 42);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
});
