import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IntegrationHealthResult } from "@nervekit/contracts/auth";
import { atlassianHealthBadge, atlassianHealthStale } from "./atlassian-health";

const result = (
  overrides: Partial<IntegrationHealthResult> = {},
): IntegrationHealthResult => ({
  status: "verified",
  checkedAt: "2026-10-01T00:00:00.000Z",
  source: "check",
  siteUrl: "https://ner.atlassian.net",
  email: "dev@example.com",
  ...overrides,
});

describe("atlassianHealthBadge", () => {
  it("keeps each outcome distinct with a label, tone, and status glyph", () => {
    const outcomes = [
      ["verified", "Verified", "success", "check"],
      ["rejected", "Credentials rejected", "destructive", "x"],
      ["restricted", "Access restricted", "warning", "alert"],
      ["unavailable", "Not on this site", "neutral", "minus"],
      ["unreachable", "Couldn’t check", "warning", "alert"],
    ] as const;
    for (const [status, label, tone, glyph] of outcomes) {
      assert.deepEqual(atlassianHealthBadge(result({ status })), {
        label,
        tone,
        glyph,
      });
    }
    assert.deepEqual(atlassianHealthBadge(undefined), {
      label: "Not checked",
      tone: "neutral",
      glyph: "help",
    });
  });
});

describe("atlassianHealthStale", () => {
  const now = new Date("2026-10-01T00:10:00.000Z").getTime();

  it("is stale while a service is unchecked or older than the limit", () => {
    assert.equal(atlassianHealthStale(undefined, now), true);
    assert.equal(
      atlassianHealthStale({ profileId: "ner", jira: result() }, now),
      true,
    );
    assert.equal(
      atlassianHealthStale(
        { profileId: "ner", jira: result(), confluence: result() },
        now,
      ),
      false,
    );
    assert.equal(
      atlassianHealthStale(
        { profileId: "ner", jira: result(), confluence: result() },
        now,
        5 * 60 * 1000,
      ),
      true,
    );
  });
});
