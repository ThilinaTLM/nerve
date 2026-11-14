import assert from "node:assert/strict";
import test from "node:test";
import { extensionSettingsDefinitions } from "@nervekit/extensions";
import {
  resolveExtensions,
  type ExtensionEntries,
} from "@nervekit/contracts/extensions";
import {
  configuredNamespaces,
  diagramServer,
  quickScriptAvailability,
  selectedAtlassianAccount,
  selectedSearchAccount,
} from "./quick-script-availability.js";

const accounts = {
  atlassianProfiles: [{ id: "acme" }],
  tavilyProfiles: [{ id: "tav" }],
};
const resolve = (user: ExtensionEntries = {}) =>
  resolveExtensions(extensionSettingsDefinitions, [
    { layer: "user", entries: user },
  ]);
const atlassian = (settings: Record<string, unknown>, enabled = true) => ({
  atlassian: { version: 1, enabled, settings },
});

void test("only the default-on Diagrams extension is configured out of the box", () => {
  const state = quickScriptAvailability(resolve(), accounts);
  assert.deepEqual(configuredNamespaces(state), ["diagram"]);
  assert.ok(!state.jira.available && !state.jira.configured);
  assert.match(
    (state.jira as { fix: string }).fix,
    /enable Jira in Settings → Extensions → Atlassian/,
  );
});

void test("an enabled product without an existing account or token is configured but unavailable", () => {
  const settings = { account: "acme", jira: true, confluence: true };
  const ok = quickScriptAvailability(resolve(atlassian(settings)), accounts);
  assert.equal(ok.jira.available, true);
  assert.equal(ok.confluence.available, true);
  assert.deepEqual(configuredNamespaces(ok), [
    "atlassian",
    "jira",
    "confluence",
    "storage",
    "diagram",
  ]);
  const missing = quickScriptAvailability(
    resolve(atlassian({ ...settings, account: "gone" })),
    accounts,
  );
  assert.equal(missing.jira.available, false);
  assert.match(
    (missing.jira as { reason: string }).reason,
    /no Atlassian account/,
  );
  const noToken = quickScriptAvailability(
    resolve(atlassian(settings)),
    accounts,
    {
      atlassian: false,
    },
  );
  assert.match((noToken.jira as { reason: string }).reason, /API token/);
  assert.equal(noToken.atlassian.available, false);
});

void test("the extension switch gates its products, the product switch the namespace", () => {
  const off = quickScriptAvailability(
    resolve(atlassian({ account: "acme", jira: true }, false)),
    accounts,
  );
  assert.equal(off.jira.configured, false);
  const jiraOnly = quickScriptAvailability(
    resolve(atlassian({ account: "acme", jira: true })),
    accounts,
  );
  assert.equal(jiraOnly.confluence.configured, false);
  assert.equal(jiraOnly.storage.configured, false);
});

void test("web needs only its switch; accounts and the diagram server read the resolved settings", () => {
  const resolution = resolve({
    web: { version: 1, enabled: true, settings: { searchAccount: "tav" } },
    diagram: { version: 1, settings: { server: "https://kroki.internal" } },
  });
  assert.deepEqual(quickScriptAvailability(resolution, accounts).web, {
    configured: true,
    available: true,
  });
  assert.equal(selectedSearchAccount(resolution, accounts), "tav");
  assert.equal(selectedAtlassianAccount(resolution, accounts), undefined);
  assert.equal(diagramServer(resolution), "https://kroki.internal/");
  assert.equal(diagramServer(resolve()), "https://kroki.io/");
});
