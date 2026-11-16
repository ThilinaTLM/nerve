import assert from "node:assert/strict";
import { test } from "node:test";
import { copilotApiHost, parseCopilotUsageResponse } from "./copilot-client.js";

const RESET = "2026-12-01T00:00:00.000Z";
const unlimited = { unlimited: true, percent_remaining: 100 };

void test("token-billed plans report AI credits with counts and overage", () => {
  const usage = parseCopilotUsageResponse({
    copilot_plan: "individual",
    token_based_billing: true,
    quota_reset_date_utc: RESET,
    quota_snapshots: {
      premium_interactions: {
        entitlement: "1500",
        quota_remaining: 540,
        percent_remaining: 36,
        unlimited: false,
        overage_permitted: true,
        overage_count: 0,
      },
      chat: unlimited,
      completions: unlimited,
    },
  });
  assert.equal(usage?.provider, "github-copilot");
  assert.equal(usage?.planType, "Pro");
  assert.deepEqual(
    usage?.quotas.map((q) => q.id),
    ["credits"],
    "unlimited chat and completions are not shown",
  );
  const [credits] = usage?.quotas ?? [];
  assert.deepEqual(
    {
      id: credits?.id,
      label: credits?.label,
      usedPercent: credits?.usedPercent,
      used: credits?.used,
      limit: credits?.limit,
      resetsAt: credits?.resetsAt,
      overage: credits?.overage,
    },
    {
      id: "credits",
      label: "AI credits",
      usedPercent: 64,
      used: 960,
      limit: 1500,
      resetsAt: RESET,
      overage: { permitted: true, used: 0 },
    },
  );
});

void test("legacy request billing reports premium requests", () => {
  const usage = parseCopilotUsageResponse({
    copilot_plan: "individual_pro",
    quota_reset_date: "2026-12-01",
    quota_snapshots: {
      premium_interactions: {
        entitlement: "1500",
        remaining: 1500,
        percent_remaining: 100,
        unlimited: false,
        overage_permitted: false,
        overage_count: 0,
      },
    },
  });
  assert.equal(usage?.planType, "Pro+");
  assert.equal(usage?.quotas[0]?.label, "Premium requests");
  assert.equal(usage?.quotas[0]?.used, 0);
});

void test("pooled organization seats report consumption without a limit", () => {
  const usage = parseCopilotUsageResponse({
    copilot_plan: "enterprise",
    token_based_billing: true,
    quota_snapshots: {
      premium_interactions: {
        unlimited: true,
        percent_remaining: 100,
        credits_used: 342.5,
        has_quota: false,
      },
    },
  });
  const quota = usage?.quotas[0];
  assert.equal(usage?.planType, "Enterprise");
  assert.equal(quota?.usedPercent, null);
  assert.equal(quota?.unlimited, true);
  assert.equal(quota?.used, 342.5);
  assert.equal(quota?.exhausted, true);
});

void test("snapshot reset time wins over the account reset date", () => {
  const usage = parseCopilotUsageResponse({
    quota_reset_date_utc: RESET,
    quota_snapshots: {
      premium_interactions: {
        entitlement: "300",
        percent_remaining: 50,
        unlimited: false,
        quota_reset_at: 1_796_083_200,
      },
    },
  });
  assert.equal(usage?.quotas[0]?.resetsAt, "2026-12-01T00:00:00.000Z");
  assert.equal(usage?.quotas[0]?.used, 150);
});

void test("Copilot Free on credits reads the capped chat snapshot as credits", () => {
  const usage = parseCopilotUsageResponse({
    access_type_sku: "free_limited_copilot",
    token_based_billing: true,
    quota_snapshots: {
      premium_interactions: {
        entitlement: "0",
        percent_remaining: 0,
        unlimited: false,
      },
      chat: {
        entitlement: "50",
        quota_remaining: 20,
        percent_remaining: 40,
        unlimited: false,
      },
      completions: {
        entitlement: "2000",
        quota_remaining: 760,
        percent_remaining: 38,
        unlimited: false,
      },
    },
  });
  assert.equal(usage?.planType, "Free");
  assert.deepEqual(
    usage?.quotas.map((q) => [q.id, q.used, q.limit]),
    [["credits", 30, 50]],
  );
});

void test("legacy Copilot Free allowances are read from monthly quotas", () => {
  const usage = parseCopilotUsageResponse({
    access_type_sku: "free_limited_copilot",
    limited_user_reset_date: "2026-12-01",
    monthly_quotas: { chat: 50, completions: 2000 },
    limited_user_quotas: { chat: 12, completions: 2000 },
  });
  assert.deepEqual(
    usage?.quotas.map((q) => [q.id, q.used, q.usedPercent]),
    [["chat", 38, 76]],
  );
});

void test("a lapsed subscription without quotas yields no snapshot", () => {
  assert.equal(parseCopilotUsageResponse({ copilot_plan: "individual" }), null);
});

void test("GitHub Enterprise logins use the api. host of their domain", () => {
  assert.equal(copilotApiHost(undefined), "api.github.com");
  assert.equal(copilotApiHost("github.com"), "api.github.com");
  assert.equal(copilotApiHost("acme.ghe.com"), "api.acme.ghe.com");
  assert.equal(copilotApiHost("https://acme.ghe.com/"), "api.acme.ghe.com");
});
