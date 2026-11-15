import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountHealthBadge,
  accountHealthIndicator,
  accountHealthStale,
  formatChecked,
} from "./account-health";

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

describe("account health indicator", () => {
  it("shows an icon only for a checked result and says when it was checked", () => {
    assert.equal(accountHealthIndicator(undefined), undefined);
    assert.equal(
      accountHealthIndicator({ status: "unavailable" })?.icon,
      "circle-minus",
    );
    assert.equal(
      accountHealthIndicator({ status: "verified" })?.class,
      "text-success",
    );
    assert.equal(
      accountHealthIndicator({ status: "unreachable" })?.class,
      "text-warning",
    );
    assert.equal(
      accountHealthIndicator({ status: "rejected" })?.class,
      "text-destructive",
    );
    const now = Date.parse("2026-01-01T12:00:00Z");
    assert.equal(
      formatChecked("2026-01-01T11:59:40Z", now),
      "checked just now",
    );
    assert.equal(
      formatChecked("2026-01-01T11:55:00Z", now),
      "checked 5 min ago",
    );
    assert.equal(formatChecked("2026-01-01T09:00:00Z", now), "checked 3 h ago");
  });
});
