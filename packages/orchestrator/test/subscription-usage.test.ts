import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAnthropicUsageResponse } from "../src/usage/anthropic-client.js";
import {
  mergeCodexUsage,
  parseCodexUsageHeaders,
  parseCodexUsageResponse,
} from "../src/usage/codex-client.js";

describe("subscription usage parsing", () => {
  it("maps Anthropic five-hour and seven-day usage", () => {
    const usage = parseAnthropicUsageResponse(
      JSON.stringify({
        five_hour: { utilization: 42.4, resets_at: "2026-01-01T05:00:00Z" },
        seven_day: { utilization: 17, resets_at: "2026-01-08T00:00:00Z" },
      }),
    );

    assert.equal(usage?.provider, "anthropic");
    assert.equal(usage?.session?.usedPercent, 42.4);
    assert.equal(usage?.session?.resetsAt, "2026-01-01T05:00:00Z");
    assert.equal(usage?.weekly?.usedPercent, 17);
    assert.equal(usage?.weekly?.resetsAt, "2026-01-08T00:00:00Z");
  });

  it("maps Codex primary and secondary API windows", () => {
    const usage = parseCodexUsageResponse(
      {
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 64,
            reset_after_seconds: 120,
            limit_window_seconds: 18_000,
          },
          secondary_window: {
            used_percent: 12,
            window_minutes: 10_080,
          },
        },
      },
      Date.UTC(2026, 0, 1),
    );

    assert.equal(usage?.provider, "openai-codex");
    assert.equal(usage?.planType, "plus");
    assert.equal(usage?.session?.usedPercent, 64);
    assert.equal(usage?.session?.resetAfterSeconds, 120);
    assert.equal(usage?.session?.windowMinutes, 300);
    assert.equal(usage?.weekly?.usedPercent, 12);
    assert.equal(usage?.weekly?.windowMinutes, 10_080);
  });

  it("parses Codex header-derived updates", () => {
    const usage = parseCodexUsageHeaders({
      "x-codex-primary-used-percent": "81",
      "x-codex-primary-reset-after-seconds": "60",
      "x-codex-secondary-used-percent": "22",
      "x-codex-secondary-window-minutes": "10080",
      "x-codex-plan-type": "pro",
    });

    assert.equal(usage?.provider, "openai-codex");
    assert.equal(usage?.planType, "pro");
    assert.equal(usage?.session?.usedPercent, 81);
    assert.equal(usage?.session?.resetAfterSeconds, 60);
    assert.equal(usage?.weekly?.usedPercent, 22);
    assert.equal(usage?.weekly?.windowMinutes, 10_080);
  });

  it("merges Codex header snapshots over cached data", () => {
    const base = parseCodexUsageResponse({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 10, reset_after_seconds: 100 },
        secondary_window: { used_percent: 20, reset_after_seconds: 200 },
      },
    });
    const update = parseCodexUsageHeaders({
      "x-codex-primary-used-percent": "55",
      "x-codex-primary-reset-after-seconds": "30",
    });

    assert.ok(base);
    assert.ok(update);
    const merged = mergeCodexUsage(base, update);
    assert.equal(merged.session?.usedPercent, 55);
    assert.equal(merged.session?.resetAfterSeconds, 30);
    assert.equal(merged.weekly?.usedPercent, 20);
    assert.equal(merged.planType, "plus");
  });
});
