import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type {
  AccountRecord,
  AccountsReader,
} from "../../../src/domains/accounts/accounts.service.js";
import { testAtlassianAccount } from "../../../src/domains/auth/account-testers.js";
import { IntegrationHealthService } from "../../../src/domains/auth/integration-health.service.js";

const kinds: AccountKind[] = [
  {
    kind: "atlassian",
    label: "Atlassian",
    fields: {},
    secret: { label: "API token" },
    test: true,
  },
  { kind: "tavily", label: "Tavily", fields: {}, secret: { label: "Key" } },
];

function fixture() {
  const accounts: AccountRecord[] = [
    {
      id: "ner",
      name: "NER",
      kind: "atlassian",
      fields: {
        siteUrl: "https://ner.atlassian.net",
        email: "dev@example.com",
      },
    },
    { id: "tav", name: "Tavily", kind: "tavily", fields: {} },
  ];
  const secrets = new Map([
    ["atlassian:ner", "token-1"],
    ["tavily:tav", "key"],
  ]);
  const reader: AccountsReader = {
    get: async (kind, id) =>
      accounts.find((a) => a.kind === kind && a.id === id),
    list: async (kind) => accounts.filter((a) => a.kind === kind),
    secret: async (kind, id) => secrets.get(`${kind}:${id}`),
    hasSecret: async (kind, id) => secrets.has(`${kind}:${id}`),
  };
  const published: string[] = [];
  const tested: string[] = [];
  const service = new IntegrationHealthService({
    accounts: reader,
    kinds: () => kinds,
    testers: {
      atlassian: async (account, secret) => {
        tested.push(`${account.id}:${secret}`);
        return { status: "verified" };
      },
      tavily: async () => ({ status: "verified" }),
    },
    publish: async (kind, id) => void published.push(`${kind}:${id}`),
    now: () => new Date("2026-10-01T00:00:00.000Z"),
  });
  return { service, accounts, secrets, published, tested };
}

describe("IntegrationHealthService", () => {
  it("tests only kinds that declare a test and lists the results", async () => {
    const { service, published, tested } = fixture();
    const health = await service.check("atlassian", "ner");
    assert.deepEqual(tested, ["ner:token-1"]);
    assert.equal(health.status, "verified");
    assert.deepEqual(published, ["atlassian:ner"]);
    assert.deepEqual(await service.list(), [health]);
    await assert.rejects(service.check("tavily", "tav"), /cannot be tested/);
  });

  it("drops results after the secret or a field changes", async () => {
    const { service, accounts, secrets } = fixture();
    await service.check("atlassian", "ner");
    secrets.set("atlassian:ner", "token-2");
    assert.deepEqual(await service.list(), []);
    secrets.set("atlassian:ner", "token-1");
    assert.equal((await service.list()).length, 1);
    accounts[0] = {
      ...accounts[0],
      fields: { ...accounts[0].fields, siteUrl: "https://other.atlassian.net" },
    };
    assert.deepEqual(await service.list(), []);
  });

  it("rejects checks for accounts without a secret", async () => {
    const { service, secrets } = fixture();
    secrets.delete("atlassian:ner");
    await assert.rejects(service.check("atlassian", "ner"), /secret/);
  });
});

describe("testAtlassianAccount", () => {
  const account: AccountRecord = {
    id: "ner",
    name: "NER",
    kind: "atlassian",
    fields: { siteUrl: "https://ner.atlassian.net", email: "dev@example.com" },
  };

  it("verifies when one service answers and names the other", async () => {
    const result = await testAtlassianAccount(async (_connection, service) =>
      service === "jira"
        ? { status: "verified" }
        : { status: "unavailable", message: "Not found" },
    )(account, "token");
    assert.equal(result.status, "verified");
    assert.match(result.message ?? "", /Confluence: Not found/);
  });

  it("reports refused credentials first and needs a site and email", async () => {
    const rejected = await testAtlassianAccount(async (_c, service) =>
      service === "jira" ? { status: "rejected" } : { status: "verified" },
    )(account, "token");
    assert.equal(rejected.status, "rejected");
    await assert.rejects(
      testAtlassianAccount()({ ...account, fields: {} }, "token"),
      /site URL and email/,
    );
  });
});
