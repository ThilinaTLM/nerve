import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountHealthBadge, accountHealthStale } from "./account-health";

describe("account health", () => {
  it("labels refused credentials apart from transient failures", () => {
    assert.equal(
      accountHealthBadge({ status: "rejected" }).tone,
      "destructive",
    );
    assert.equal(accountHealthBadge({ status: "unreachable" }).tone, "warning");
    assert.equal(accountHealthBadge(undefined).label, "Not checked");
  });

  it("re-tests missing and old results only", () => {
    const now = Date.parse("2026-10-01T01:00:00.000Z");
    assert.equal(accountHealthStale(undefined, now), true);
    assert.equal(
      accountHealthStale({ checkedAt: "2026-10-01T00:55:00.000Z" }, now),
      false,
    );
    assert.equal(
      accountHealthStale({ checkedAt: "2026-10-01T00:30:00.000Z" }, now),
      true,
    );
  });
});
