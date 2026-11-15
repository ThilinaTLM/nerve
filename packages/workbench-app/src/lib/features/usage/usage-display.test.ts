import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubscriptionQuota, SubscriptionUsage } from "$lib/api";
import {
  consumptionChipValue,
  consumptionQuotas,
  meterTone,
  meterValue,
  quotaCaption,
  quotaMeters,
  unlimitedSummary,
} from "./usage-display";

const RESET = "2026-12-01T00:00:00.000Z";

function quota(overrides: Partial<SubscriptionQuota>): SubscriptionQuota {
  return {
    id: "credits",
    label: "AI credits",
    unit: "credits",
    usedPercent: 64,
    used: 960,
    limit: 1500,
    resetsAt: RESET,
    resetAfterSeconds: null,
    windowMinutes: null,
    ...overrides,
  };
}

function usage(quotas: SubscriptionQuota[]): SubscriptionUsage {
  return {
    provider: "github-copilot",
    quotas,
    updatedAt: "2026-11-15T00:00:00.000Z",
  };
}

test("allowances show counts and what is left before the reset date", () => {
  const credits = quota({});
  assert.equal(meterValue(credits).replace(/\D+/g, " ").trim(), "960 1 500");
  assert.match(quotaCaption(credits) ?? "", /^540 left · resets Dec 1$/);
  assert.equal(quotaMeters(usage([credits]))[0]?.abbreviation, null);
});

test("time windows keep their percentage and duration abbreviation", () => {
  const session = quota({
    id: "session",
    label: "Session",
    used: undefined,
    limit: undefined,
    unit: undefined,
    resetsAt: null,
    windowMinutes: 300,
    usedPercent: 42,
  });
  assert.equal(meterValue(session), "42%");
  assert.equal(quotaMeters(usage([session]))[0]?.abbreviation, "S");
});

test("billed overage warns, a hard limit is destructive", () => {
  const overage = quota({
    usedPercent: 100,
    used: 1500,
    overage: { permitted: true, used: 14 },
  });
  assert.match(
    quotaCaption(overage) ?? "",
    /^\+14 credits billed as additional usage/,
  );
  assert.equal(meterTone(overage), "warning");

  const blocked = quota({
    usedPercent: 100,
    used: 1500,
    overage: { permitted: false, used: 0 },
  });
  assert.match(quotaCaption(blocked) ?? "", /^Limit reached/);
  assert.equal(meterTone(blocked), "destructive");
});

test("pooled seats report consumption; unlimited items collapse to one line", () => {
  const pooled = quota({
    usedPercent: null,
    limit: undefined,
    used: 342.4,
    unlimited: true,
  });
  const chat = quota({
    id: "chat",
    label: "Chat",
    usedPercent: null,
    used: undefined,
    limit: undefined,
    unlimited: true,
  });
  const completions = { ...chat, id: "completions", label: "Completions" };
  const snapshot = usage([pooled, chat, completions]);
  assert.deepEqual(quotaMeters(snapshot), []);
  assert.deepEqual(consumptionQuotas(snapshot), [pooled]);
  assert.equal(consumptionChipValue(pooled), "342 cr");
  assert.equal(unlimitedSummary(snapshot), "Chat and Completions unlimited");
  assert.equal(
    consumptionChipValue({ ...pooled, exhausted: true }),
    "limit reached",
  );
});
