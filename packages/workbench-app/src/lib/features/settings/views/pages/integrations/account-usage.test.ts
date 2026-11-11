import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountUsage,
  accountUsedEverywhere,
  useAccountEverywhere,
} from "./account-usage";

test("a consumer is in use only when on with an existing account; quick script also needs its integration on", () => {
  const usage = accountUsage(
    "atlassian",
    {
      jira: { enabled: true, profileId: "a" },
      confluence: { enabled: true, profileId: "deleted" },
      quick_script: {
        enabled: true,
        settings: {
          jira: { enabled: true, profileId: "b" },
          confluence: { enabled: false, profileId: "a" },
        },
      },
    },
    ["a", "b"],
  );
  assert.deepEqual(usage.inUse, [
    { label: "Jira", accountId: "a" },
    { label: "Quick script (Jira)", accountId: "b" },
  ]);
  assert.deepEqual(usage.available, [
    "Confluence",
    "Quick script (Confluence)",
  ]);
});

test("a disabled quick script hides its enabled integrations from use", () => {
  const usage = accountUsage(
    "tavily",
    {
      web_search: { enabled: false, profileId: "t" },
      quick_script: {
        enabled: false,
        settings: { web: { enabled: true, profileId: "t" } },
      },
    },
    ["t"],
  );
  assert.deepEqual(usage.inUse, []);
  assert.deepEqual(usage.available, ["Web search", "Quick script (Web)"]);
});

test("using an account everywhere selects it for every consumer without toggling any", () => {
  assert.deepEqual(useAccountEverywhere("atlassian", "a"), {
    tools: {
      jira: { profileId: "a" },
      confluence: { profileId: "a" },
      quick_script: {
        settings: { jira: { profileId: "a" }, confluence: { profileId: "a" } },
      },
    },
  });
  assert.equal(
    accountUsedEverywhere(
      "tavily",
      {
        web_search: { profileId: "t" },
        quick_script: { settings: { web: { enabled: false, profileId: "t" } } },
      },
      "t",
    ),
    true,
  );
  assert.equal(
    accountUsedEverywhere("tavily", { web_search: { profileId: "t" } }, "t"),
    false,
  );
});
