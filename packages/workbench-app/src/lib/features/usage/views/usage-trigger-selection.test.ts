import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubscriptionUsageEntry } from "../usage-types";
import { selectUsageTriggerEntry } from "./usage-trigger-selection";

function entry(
  provider: SubscriptionUsageEntry["provider"],
  active = false,
  slot?: "session" | "weekly",
): SubscriptionUsageEntry {
  return {
    provider,
    active,
    usage: {
      provider,
      updatedAt: "2026-10-12T00:00:00.000Z",
      session: null,
      weekly: null,
      ...(slot
        ? {
            [slot]: {
              usedPercent: 25,
              resetsAt: null,
              resetAfterSeconds: null,
              windowMinutes: null,
            },
          }
        : {}),
    },
  };
}

for (const provider of ["anthropic", "openai-codex"] as const) {
  test(`active ${provider} wins over another provider's windows`, () => {
    const other = entry(
      provider === "anthropic" ? "openai-codex" : "anthropic",
      false,
      "session",
    );
    for (const active of [
      { provider, active: true },
      entry(provider, true),
      entry(provider, true, "weekly"),
    ]) {
      assert.equal(selectUsageTriggerEntry([other, active]), active);
    }
  });

  test(`active ${provider} keeps the trigger visible without any windows`, () => {
    const active = entry(provider, true);
    assert.equal(selectUsageTriggerEntry([active]), active);
    const unavailable = { provider, active: true };
    assert.equal(selectUsageTriggerEntry([unavailable]), unavailable);
  });
}

test("without an active entry, select the first provider with either window", () => {
  for (const slot of ["session", "weekly"] as const) {
    const empty = entry("anthropic");
    const available = entry("openai-codex", false, slot);
    assert.equal(selectUsageTriggerEntry([empty, available]), available);
    const second = entry("anthropic", false, "session");
    assert.equal(selectUsageTriggerEntry([available, second]), available);
  }
});

test("hide the trigger when there is neither an active entry nor windows", () => {
  assert.equal(selectUsageTriggerEntry([]), undefined);
  assert.equal(
    selectUsageTriggerEntry([
      { provider: "anthropic", active: false },
      entry("openai-codex"),
    ]),
    undefined,
  );
});
