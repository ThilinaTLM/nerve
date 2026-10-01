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
  it("only calls refused credentials rejected", () => {
    assert.deepEqual(atlassianHealthBadge(result({ status: "rejected" })), {
      label: "Credentials rejected",
      tone: "destructive",
    });
    assert.equal(
      atlassianHealthBadge(result({ status: "unreachable" })).tone,
      "warning",
    );
    assert.equal(atlassianHealthBadge(undefined).label, "Not checked");
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
