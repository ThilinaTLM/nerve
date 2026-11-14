import assert from "node:assert/strict";
import test from "node:test";
import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import {
  resolveExtensions,
  type ExtensionEntries,
} from "@nervekit/contracts/extensions";
import { createQuickScriptRegistry } from "@nervekit/tools/quick-script";
import { selectedAccountsTarget } from "./extension-ports.js";

const extension = defineExtension({
  apiVersion: 1,
  id: "demo",
  name: "Demo",
  description: "Test.",
  icon: "box",
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
const accounts = {
  get: async (kind: string, id: string) =>
    sites.has(id)
      ? { id, kind, name: "Acme", fields: { site: sites.get(id) } }
      : undefined,
  list: async () => [],
  secret: async () => "TOP-SECRET",
  hasSecret: async () => true,
};
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
