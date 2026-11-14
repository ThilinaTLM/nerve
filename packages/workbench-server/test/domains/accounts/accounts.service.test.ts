import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { defaultUserConfiguration } from "@nervekit/contracts/settings";
import { AccountsService } from "../../../src/domains/accounts/accounts.service.js";
import { initializeHomeConfiguration } from "../../../src/infrastructure/configuration/home-configuration.js";
import {
  storagePaths,
  type InitializedStorage,
} from "../../../src/infrastructure/storage-bootstrap/index.js";

const kinds: AccountKind[] = [
  {
    kind: "atlassian",
    label: "Atlassian account",
    fields: {
      siteUrl: { type: "string", label: "Site URL", format: "url" },
      email: { type: "string", label: "Email" },
    },
    secret: { label: "API token" },
    test: true,
  },
  {
    kind: "tavily",
    label: "Tavily account",
    fields: {},
    secret: { label: "API key" },
  },
];

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0))
    rmSync(home, { recursive: true, force: true });
});

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), "nerve-accounts-"));
  homes.push(home);
  const paths = storagePaths(home);
  const storage = {
    paths,
    configuration: await initializeHomeConfiguration(paths),
  } as InitializedStorage;
  const secrets = new Map<string, string>();
  const auth = {
    setApiKey: async (id: string, key: string) => void secrets.set(id, key),
    getApiKey: async (id: string) => secrets.get(id),
    getCredential: async (id: string) =>
      secrets.has(id)
        ? ({ type: "api_key", key: secrets.get(id)! } as const)
        : undefined,
    deleteCredential: async (id: string) => void secrets.delete(id),
  };
  const service = new AccountsService({ storage, auth, kinds: () => kinds });
  return { service, paths, secrets, storage };
}

describe("AccountsService", () => {
  it("saves accounts by kind to accounts.json and keeps their secrets under account:<kind>:<id>", async () => {
    const { service, paths, secrets } = await fixture();
    const saved = await service.save({
      kind: "atlassian",
      name: "Acme",
      fields: { siteUrl: "https://acme.atlassian.net", email: "a@acme.test" },
    });
    await service.setSecret("atlassian", saved.id, "token");
    assert.deepEqual([...secrets.keys()], [`account:atlassian:${saved.id}`]);
    assert.equal(await service.secret("atlassian", saved.id), "token");
    assert.equal(await service.hasSecret("tavily", saved.id), false);
    assert.deepEqual(
      JSON.parse(readFileSync(paths.accountsConfigPath, "utf8")),
      {
        version: 2,
        accounts: {
          atlassian: [
            {
              id: saved.id,
              name: "Acme",
              fields: {
                siteUrl: "https://acme.atlassian.net/",
                email: "a@acme.test",
              },
            },
          ],
        },
      },
    );
    assert.deepEqual(await service.get("atlassian", saved.id), {
      ...saved,
      kind: "atlassian",
    });
    assert.deepEqual(await service.list("tavily"), []);
    assert.equal((await service.views())[0].secretConfigured, true);
  });

  it("updates in place, rejects unknown kinds, fields and ids, and deletes the secret with the account", async () => {
    const { service, secrets } = await fixture();
    const { id } = await service.save({
      kind: "tavily",
      name: "One",
      fields: {},
    });
    await service.setSecret("tavily", id, "key");
    await service.save({ kind: "tavily", id, name: "Renamed", fields: {} });
    assert.equal((await service.list("tavily"))[0].name, "Renamed");
    await assert.rejects(
      service.save({ kind: "jira", name: "x", fields: {} }),
      /No extension defines/,
    );
    await assert.rejects(
      service.save({ kind: "tavily", name: "x", fields: { extra: "1" } }),
      /no field/,
    );
    await assert.rejects(
      service.save({ kind: "tavily", id: "missing", name: "x", fields: {} }),
      /does not exist/,
    );
    assert.equal(await service.delete("tavily", id), true);
    assert.equal(await service.delete("tavily", id), false);
    assert.equal(secrets.size, 0);
    assert.deepEqual(await service.list("tavily"), []);
  });

  it("rejects duplicate kinds across extensions", () => {
    assert.throws(
      () =>
        new AccountsService({
          storage: {
            configuration: defaultUserConfiguration,
          } as InitializedStorage,
          auth: {} as never,
          kinds: () => [kinds[0], kinds[0]],
        }),
      /both/,
    );
  });
});
