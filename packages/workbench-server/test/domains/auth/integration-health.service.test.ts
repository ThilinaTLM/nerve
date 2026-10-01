import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AtlassianProfile } from "@nervekit/contracts/settings";
import { IntegrationHealthService } from "../../../src/domains/auth/integration-health.service.js";

function fixture() {
  const documents = new Map<string, { data: unknown; revision: number }>();
  const profiles: AtlassianProfile[] = [
    {
      id: "ner",
      name: "NER",
      siteUrl: "https://ner.atlassian.net",
      email: "dev@example.com",
    },
  ];
  const tokens = new Map([["ner", "token-1"]]);
  const published: string[] = [];
  const checks: string[] = [];
  const service = new IntegrationHealthService({
    store: {
      readDocument: async <T>(_n: string, _s: string, id: string) =>
        documents.get(id) as { data: T; revision: number } | undefined,
      writeDocument: async (input) => {
        const revision = (documents.get(input.documentId)?.revision ?? 0) + 1;
        documents.set(input.documentId, { data: input.data, revision });
      },
    },
    profiles: () => profiles,
    getToken: async (id) => tokens.get(id),
    publish: async (id) => {
      published.push(id);
    },
    check: async (connection, service) => {
      checks.push(`${service}:${connection.token}`);
      return service === "jira"
        ? { status: "verified" }
        : { status: "unavailable", message: "Not found" };
    },
    now: () => new Date("2026-10-01T00:00:00.000Z"),
  });
  return { service, profiles, tokens, published, checks };
}

describe("IntegrationHealthService", () => {
  it("checks both services and lists the persisted results", async () => {
    const { service, published, checks } = fixture();
    const health = await service.check("ner");
    assert.deepEqual(checks, ["jira:token-1", "confluence:token-1"]);
    assert.equal(health.jira?.status, "verified");
    assert.equal(health.jira?.source, "check");
    assert.equal(health.confluence?.status, "unavailable");
    assert.ok(!("credentialDigest" in (health.jira ?? {})));
    assert.deepEqual(published, ["ner"]);
    assert.deepEqual(await service.list(), [health]);
  });

  it("drops results after the token, site, or email changes", async () => {
    const { service, profiles, tokens } = fixture();
    await service.check("ner");

    tokens.set("ner", "token-2");
    assert.deepEqual(await service.list(), [{ profileId: "ner" }]);

    tokens.set("ner", "token-1");
    profiles[0] = { ...profiles[0], siteUrl: "https://other.atlassian.net" };
    assert.deepEqual(await service.list(), [{ profileId: "ner" }]);
  });

  it("rejects checks for incomplete profiles", async () => {
    const { service, tokens } = fixture();
    tokens.delete("ner");
    await assert.rejects(service.check("ner"), /API token/);
  });

  it("records only credential evidence from tool outcomes", async () => {
    const { service, profiles, published } = fixture();
    const profile = profiles[0];

    await service.recordToolOutcome({
      profile,
      service: "jira",
      errorCode: "JIRA_RATE_LIMITED",
    });
    await service.recordToolOutcome({
      profile,
      service: "jira",
      errorCode: "JIRA_FORBIDDEN",
    });
    assert.deepEqual(await service.list(), [{ profileId: "ner" }]);

    await service.recordToolOutcome({
      profile,
      service: "jira",
      errorCode: "JIRA_UNAUTHORIZED",
      message: "Unauthorized",
    });
    const [rejected] = await service.list();
    assert.equal(rejected?.jira?.status, "rejected");
    assert.equal(rejected?.jira?.source, "tool");

    await service.recordToolOutcome({ profile, service: "jira" });
    await service.recordToolOutcome({ profile, service: "jira" });
    assert.equal((await service.list())[0]?.jira?.status, "verified");
    // The repeated success does not publish again.
    assert.deepEqual(published, ["ner", "ner"]);
  });
});
