import assert from "node:assert/strict";
import test from "node:test";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import {
  configuredNamespaces,
  quickScriptAvailability,
} from "./quick-script-availability.js";

const settings = (quickScript: Record<string, unknown>) =>
  ({
    tools: { quick_script: { settings: quickScript } },
  }) as LeadSettingsOverrides;

void test("a switched-off namespace is unconfigured and says how to enable it", () => {
  const state = quickScriptAvailability(settings({}), []);
  assert.deepEqual(configuredNamespaces(state), ["diagram"]);
  assert.ok(!state.jira.available && !state.jira.configured);
  assert.match((state.jira as { fix: string }).fix, /enable Jira/);
});

void test("an enabled product without an account or token is configured but unavailable", () => {
  const config = {
    jira: { enabled: true, profileId: "p1" },
    confluence: { enabled: true },
  };
  const state = quickScriptAvailability(settings(config), []);
  assert.equal(state.jira.available, true);
  assert.equal(state.confluence.available, false);
  assert.match(
    (state.confluence as { reason: string }).reason,
    /no Atlassian account/,
  );
  assert.deepEqual(configuredNamespaces(state), [
    "atlassian",
    "jira",
    "confluence",
    "storage",
    "diagram",
  ]);
  const gone = quickScriptAvailability(settings(config), [
    "/tools/quick_script/settings/jira/profileId",
  ]);
  assert.equal(gone.jira.available, false);
  const noToken = quickScriptAvailability(settings(config), [], {
    jira: false,
  });
  assert.match((noToken.jira as { reason: string }).reason, /API token/);
  assert.equal(noToken.atlassian.available, false);
});

void test("web needs only its switch", () => {
  const state = quickScriptAvailability(
    settings({ web: { enabled: true } }),
    [],
  );
  assert.deepEqual(state.web, { configured: true, available: true });
});
