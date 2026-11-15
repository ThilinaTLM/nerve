import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import {
  healthSummary,
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

void test("healthSummary names the status, the first line of the reason and the check time", () => {
  const now = Date.parse("2026-11-15T10:00:00Z");
  assert.equal(
    healthSummary(
      {
        status: "unavailable",
        checkedAt: "2026-11-15T09:58:00Z",
        message: "Jira: GET /myself failed (404)\nConfluence: failed",
      },
      now,
    ),
    "Not available · Jira: GET /myself failed (404) · checked 2 min ago",
  );
  assert.equal(
    healthSummary(
      { status: "verified", checkedAt: "2026-11-15T10:00:00Z", message: "ok" },
      now,
    ),
    "Verified · checked just now",
  );
});
