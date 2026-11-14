import assert from "node:assert/strict";
import test from "node:test";
import { extensionSettingsDefinitions } from "@nervekit/extensions";
import {
  resolveExtensions,
  type ExtensionEntries,
} from "@nervekit/contracts/extensions";
import { configuredNamespaces } from "@nervekit/tools/quick-script";
import type { AccountsReader } from "../domains/accounts/accounts.service.js";
import {
  extensionAvailability,
  extensionToolOffered,
} from "./extension-availability.js";
import { hostRegistry } from "./host-tools.js";

const accounts = (options: { secrets?: boolean } = {}): AccountsReader => {
  const known = new Map([
    ["atlassian:acme", "Acme"],
    ["tavily:tav", "Tav"],
  ]);
  return {
    get: async (kind, id) =>
      known.has(`${kind}:${id}`)
        ? { id, kind, name: known.get(`${kind}:${id}`)!, fields: {} }
        : undefined,
    list: async () => [],
    secret: async () => (options.secrets === false ? undefined : "secret"),
    hasSecret: async () => options.secrets !== false,
  };
};
const resolve = (user: ExtensionEntries = {}) =>
  resolveExtensions(extensionSettingsDefinitions, [
    { layer: "user", entries: user },
  ]);
const atlassian = (settings: Record<string, unknown>, enabled = true) => ({
  atlassian: { version: 1, enabled, settings },
});
const derive = (
  resolution: ReturnType<typeof resolve>,
  options: { secrets?: boolean; checkSecrets?: boolean } = {},
) =>
  extensionAvailability(hostRegistry, resolution, accounts(options), {
    checkSecrets: options.checkSecrets ?? true,
  });

void test("only the default-on Diagrams extension is configured out of the box", async () => {
  const { namespaces } = await derive(resolve());
  assert.deepEqual(configuredNamespaces(namespaces), ["diagram"]);
  assert.ok(!namespaces.jira.available && !namespaces.jira.configured);
  assert.match(
    (namespaces.jira as { fix: string }).fix,
    /enable it in Settings → Extensions → Atlassian/,
  );
});

void test("an enabled product without an existing account or token is configured but unavailable", async () => {
  const settings = { account: "acme", jira: true, confluence: true };
  const ok = (await derive(resolve(atlassian(settings)))).namespaces;
  assert.equal(ok.jira.available, true);
  assert.equal(ok.confluence.available, true);
  assert.deepEqual(configuredNamespaces(ok), [
    "atlassian",
    "jira",
    "confluence",
    "storage",
    "diagram",
  ]);
  const missing = (
    await derive(resolve(atlassian({ ...settings, account: "gone" })))
  ).namespaces;
  assert.equal(missing.jira.available, false);
  assert.match(
    (missing.jira as { reason: string }).reason,
    /no Atlassian account is selected/,
  );
  assert.match(
    (missing.jira as { fix: string }).fix,
    /choose the Atlassian account with a saved API token in Settings → Extensions → Atlassian/,
  );
  const noToken = (
    await derive(resolve(atlassian(settings)), { secrets: false })
  ).namespaces;
  assert.match((noToken.jira as { reason: string }).reason, /API token/);
  assert.equal(noToken.atlassian.available, false);
  // The tool description only needs `configured`.
  const unchecked = (
    await derive(resolve(atlassian(settings)), {
      secrets: false,
      checkSecrets: false,
    })
  ).namespaces;
  assert.equal(unchecked.jira.available, true);
});

void test("the extension switch gates its products, the product switch the namespace", async () => {
  const off = (
    await derive(resolve(atlassian({ account: "acme", jira: true }, false)))
  ).namespaces;
  assert.equal(off.jira.configured, false);
  const jiraOnly = (
    await derive(resolve(atlassian({ account: "acme", jira: true })))
  ).namespaces;
  assert.equal(jiraOnly.confluence.configured, false);
  assert.equal(jiraOnly.storage.configured, false);
  assert.equal(jiraOnly.atlassian.configured, true);
  assert.match(
    (jiraOnly.confluence as { reason: string }).reason,
    /Confluence is switched off in the Atlassian extension/,
  );
});

void test("web needs only its switch; web_search also needs its search account with a saved token", async () => {
  const withAccount = resolve({
    web: { version: 1, enabled: true, settings: { searchAccount: "tav" } },
  });
  assert.deepEqual((await derive(withAccount)).namespaces.web, {
    configured: true,
    available: true,
  });
  assert.equal(
    extensionToolOffered(await derive(withAccount), "web_search"),
    true,
  );
  assert.equal(
    extensionToolOffered(
      await derive(withAccount, { secrets: false }),
      "web_search",
    ),
    false,
  );
  const noAccount = resolve({ web: { version: 1, enabled: true } });
  assert.equal(
    extensionToolOffered(await derive(noAccount), "web_search"),
    false,
  );
  assert.equal((await derive(noAccount)).namespaces.web.available, true);
});

void test("tools the extensions do not contribute are not gated here", async () => {
  assert.equal(extensionToolOffered(await derive(resolve()), "read"), true);
});
