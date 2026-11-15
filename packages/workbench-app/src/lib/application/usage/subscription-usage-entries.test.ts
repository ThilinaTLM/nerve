import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubscriptionUsage } from "@nervekit/contracts/usage";
import { subscriptionUsageEntries } from "./subscription-usage-entries";

const anthropic: SubscriptionUsage = {
  provider: "anthropic",
  quotas: [
    {
      id: "session",
      label: "Session",
      usedPercent: 25,
      resetsAt: null,
      resetAfterSeconds: null,
      windowMinutes: 300,
    },
  ],
  planType: null,
  updatedAt: "2026-10-12T00:00:00Z",
};
const codex: SubscriptionUsage = { ...anthropic, provider: "openai-codex" };

test("usage entries follow the selected provider without discarding other snapshots", () => {
  const usages = { anthropic, "openai-codex": codex };
  for (const provider of ["anthropic", "openai-codex"]) {
    const entries = subscriptionUsageEntries(usages, provider);
    assert.deepEqual(
      entries.map((entry) => entry.provider),
      ["anthropic", "openai-codex"],
    );
    assert.equal(entries.find((entry) => entry.active)?.provider, provider);
    assert.equal(entries[0].usage, anthropic);
    assert.equal(entries[1].usage, codex);
  }
});

test("selected provider remains active when its snapshot has not arrived", () => {
  const entries = subscriptionUsageEntries(
    { "openai-codex": codex },
    "anthropic",
  );
  assert.equal(entries[0].active, true);
  assert.equal(entries[0].usage, undefined);
  assert.equal(entries[1].active, false);
});

test("providers without a snapshot are listed only while selected", () => {
  assert.deepEqual(
    subscriptionUsageEntries({ anthropic }, "openai").map((e) => e.provider),
    ["anthropic"],
  );
  assert.deepEqual(
    subscriptionUsageEntries({ anthropic }, "github-copilot").map(
      (e) => e.provider,
    ),
    ["anthropic", "github-copilot"],
  );
});

test("unsupported or absent selection does not mark a subscription provider active", () => {
  for (const provider of [undefined, "openai", "google"]) {
    assert.ok(
      subscriptionUsageEntries({ anthropic }, provider).every(
        (entry) => !entry.active,
      ),
    );
  }
});
