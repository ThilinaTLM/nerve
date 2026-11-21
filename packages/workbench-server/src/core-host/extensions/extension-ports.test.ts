import assert from "node:assert/strict";
import test from "node:test";
import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import {
  resolveExtensions,
  type ExtensionEntries,
} from "@nervekit/contracts/extensions";
import { createQuickScriptRegistry } from "@nervekit/tools/quick-script";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import { fakeAccountsReader } from "../../domains/accounts/test-support.js";
import { selectedAccountsTarget } from "./extension-ports.js";

const extension = defineExtension({
  id: "demo",
  name: "Demo",
  description: "Test.",
  icon: "blocks",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: { account: { type: "account", kind: "demo", label: "Account" } },
  },
  accounts: {
    demo: {
      label: "Demo account",
      fields: { site: { type: "string", label: "Site" } },
      secret: { label: "Token" },
    },
  },
  namespaces: [
    defineNamespace({ id: "demo", summary: "demo", types: "", methods: {} }),
  ],
});
const registry = createQuickScriptRegistry([extension]);

const sites = new Map([["a1", "https://one.example"]]);
const accounts: AccountsReader = fakeAccountsReader({
  get: async (kind, id) =>
    sites.has(id)
      ? {
          id,
          kind,
          name: "Acme",
          fields: { site: sites.get(id) },
          level: "user",
        }
      : undefined,
});
const resolution = (entries: ExtensionEntries) =>
  resolveExtensions(
    [
      {
        id: "demo",
        settingsVersion: 1,
        enabledByDefault: false,
        settings: extension.settings,
      },
    ],
    [{ layer: "user", entries }],
  );
const on = { demo: { version: 1, enabled: true, settings: { account: "a1" } } };

void test("the approval target covers each enabled extension's selected account and its non-secret fields", async () => {
  const before = await selectedAccountsTarget(
    registry,
    resolution(on),
    accounts,
  );
  assert.deepEqual(before, {
    demo: {
      account: {
        id: "a1",
        kind: "demo",
        name: "Acme",
        fields: { site: "https://one.example" },
        level: "user",
      },
    },
  });
  assert.ok(!JSON.stringify(before).includes("TOP-SECRET"));
  sites.set("a1", "https://two.example");
  const after = await selectedAccountsTarget(
    registry,
    resolution(on),
    accounts,
  );
  assert.notDeepEqual(
    after,
    before,
    "switching the account's site changes the target",
  );
  sites.set("a1", "https://one.example");
});

void test("a disabled extension, or an unset or deleted account, adds no account fields to the target", async () => {
  assert.deepEqual(
    await selectedAccountsTarget(
      registry,
      resolution({ demo: { ...on.demo, enabled: false } }),
      accounts,
    ),
    {},
  );
  assert.deepEqual(
    await selectedAccountsTarget(
      registry,
      resolution({ demo: { version: 1, enabled: true, settings: {} } }),
      accounts,
    ),
    {},
  );
  assert.deepEqual(
    await selectedAccountsTarget(
      registry,
      resolution({
        demo: { version: 1, enabled: true, settings: { account: "gone" } },
      }),
      accounts,
    ),
    { demo: { account: { id: "gone", missing: true } } },
  );
});

void test("the approval target finds the selected account among several accepted kinds", async () => {
  const multi = defineExtension({
    ...extension,
    settings: {
      version: 1,
      fields: {
        account: { type: "account", kind: ["first", "demo"], label: "Account" },
      },
    },
  });
  const asked: string[] = [];
  const target = await selectedAccountsTarget(
    createQuickScriptRegistry([multi]),
    resolveExtensions(
      [
        {
          id: "demo",
          settingsVersion: 1,
          enabledByDefault: false,
          settings: multi.settings,
        },
      ],
      [{ layer: "user", entries: on }],
    ),
    {
      ...accounts,
      get: async (kind, id) => {
        asked.push(kind);
        return kind === "first" ? undefined : accounts.get(kind, id);
      },
    },
  );
  assert.deepEqual(asked, ["first", "demo"]);
  assert.equal((target.demo.account as { kind: string }).kind, "demo");
});

void test("an account setting saved at user scope selects user-level accounts only", async () => {
  const levels = new Map<string, "user" | "project">([
    ["u1", "user"],
    ["p1", "project"],
  ]);
  const reader: AccountsReader = {
    ...accounts,
    get: async (kind, id, options) => {
      const level = levels.get(id);
      return !level || (level === "project" && options?.userLevelOnly)
        ? undefined
        : { id, kind, name: id, fields: {}, level };
    },
  };
  const target = async (layer: "user" | "project", id: string) =>
    (await selectedAccountsTarget(
      registry,
      resolveExtensions(
        [
          {
            id: "demo",
            settingsVersion: 1,
            enabledByDefault: false,
            settings: extension.settings,
          },
        ],
        [
          {
            layer,
            entries: {
              demo: { version: 1, enabled: true, settings: { account: id } },
            },
          },
        ],
      ),
      reader,
    )) as Record<string, Record<string, { missing?: boolean }>>;
  assert.deepEqual(await target("user", "p1"), {
    demo: { account: { id: "p1", missing: true } },
  });
  assert.equal((await target("project", "p1")).demo.account.missing, undefined);
  assert.equal((await target("user", "u1")).demo.account.missing, undefined);
});
