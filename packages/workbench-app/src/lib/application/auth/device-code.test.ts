import assert from "node:assert/strict";
import test from "node:test";
import { deviceCodeSecondsRemaining } from "./device-code";

test("device-code countdown rounds up and never becomes negative", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(deviceCodeSecondsRemaining("2026-01-01T00:00:01.001Z", now), 2);
  assert.equal(deviceCodeSecondsRemaining("2025-12-31T23:59:00.000Z", now), 0);
  assert.equal(deviceCodeSecondsRemaining(undefined, now), undefined);
});
