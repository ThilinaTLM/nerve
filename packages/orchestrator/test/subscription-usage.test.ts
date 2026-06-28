import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubscriptionUsage } from "@nervekit/shared";
import type { AuthManager } from "../src/domains/auth/index.js";
import { parseAnthropicUsageResponse } from "../src/domains/usage/anthropic-client.js";
import {
  mergeCodexUsage,
  parseCodexUsageHeaders,
  parseCodexUsageResponse,
} from "../src/domains/usage/codex-client.js";
import { SubscriptionUsageService } from "../src/domains/usage/subscription-usage-service.js";
import type { EventBus } from "../src/infrastructure/events/index.js";

function testUsage(
  provider: SubscriptionUsage["provider"],
  usedPercent: number,
): SubscriptionUsage {
  return {
    provider,
    session: {
      usedPercent,
      resetsAt: null,
      resetAfterSeconds: null,
      windowMinutes: null,
    },
    weekly: null,
    planType: null,
    updatedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  };
}

function fakeAuth(configuredProviders: SubscriptionUsage["provider"][]) {
  const configured = new Set<string>(configuredProviders);
  return {
    configured,
    auth: {
      async credentialType(provider: string) {
        return configured.has(provider) ? "oauth" : undefined;
      },
      async getApiKey(provider: string) {
        return configured.has(provider) ? `${provider}-token` : undefined;
      },
    } as unknown as AuthManager,
  };
}

function fakeEvents() {
  const published: Array<{ type: string; data: unknown }> = [];
  return {
    published,
    events: {
      async publish(type: string, data: unknown) {
        published.push({ type, data });
      },
    } as unknown as EventBus,
  };
}

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

describe("subscription usage service", () => {
  it("refreshes global providers on demand without touchProvider", async () => {
    const { auth } = fakeAuth(["anthropic", "openai-codex"]);
    const { events, published } = fakeEvents();
    let anthropicCalls = 0;
    let codexCalls = 0;
    const service = new SubscriptionUsageService({
      auth,
      events,
      cacheDir: "/tmp/nerve-usage-test",
      fetchAnthropicUsage: async () => {
        anthropicCalls += 1;
        return testUsage("anthropic", 11);
      },
      fetchCodexUsage: async () => {
        codexCalls += 1;
        return testUsage("openai-codex", 22);
      },
    });

    const snapshots = await service.getSnapshots({ refresh: true });

    assert.equal(anthropicCalls, 1);
    assert.equal(codexCalls, 1);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.provider).sort(), [
      "anthropic",
      "openai-codex",
    ]);
    assert.equal(published.length, 2);
  });

  it("debounces upstream refresh attempts per provider for 30 seconds", async () => {
    const { auth } = fakeAuth(["anthropic", "openai-codex"]);
    const { events } = fakeEvents();
    let now = 1_000;
    let anthropicCalls = 0;
    let codexCalls = 0;
    const service = new SubscriptionUsageService({
      auth,
      events,
      cacheDir: "/tmp/nerve-usage-test",
      now: () => now,
      fetchAnthropicUsage: async () => {
        anthropicCalls += 1;
        return testUsage("anthropic", anthropicCalls);
      },
      fetchCodexUsage: async () => {
        codexCalls += 1;
        return testUsage("openai-codex", codexCalls);
      },
    });

    await service.getSnapshots({ refresh: true });
    now += 10_000;
    const debounced = await service.getSnapshots({ refresh: true });
    now += 20_001;
    const refreshed = await service.getSnapshots({ refresh: true });

    assert.equal(anthropicCalls, 2);
    assert.equal(codexCalls, 2);
    assert.equal(
      debounced.find((snapshot) => snapshot.provider === "anthropic")?.session
        ?.usedPercent,
      1,
    );
    assert.equal(
      refreshed.find((snapshot) => snapshot.provider === "anthropic")?.session
        ?.usedPercent,
      2,
    );
  });

  it("removes snapshots for providers that no longer have OAuth auth", async () => {
    const { auth, configured } = fakeAuth(["anthropic", "openai-codex"]);
    const { events } = fakeEvents();
    let now = 1_000;
    const service = new SubscriptionUsageService({
      auth,
      events,
      cacheDir: "/tmp/nerve-usage-test",
      now: () => now,
      fetchAnthropicUsage: async () => testUsage("anthropic", 1),
      fetchCodexUsage: async () => testUsage("openai-codex", 2),
    });

    await service.getSnapshots({ refresh: true });
    configured.delete("anthropic");
    now += 30_001;
    const snapshots = await service.getSnapshots({ refresh: true });

    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.provider),
      ["openai-codex"],
    );
  });
});
