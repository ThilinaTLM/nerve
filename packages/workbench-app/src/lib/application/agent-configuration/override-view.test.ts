import assert from "node:assert/strict";
import { test } from "node:test";
import { applySettingsMutation } from "@nervekit/contracts/agent-configuration";
import {
  mutateDraftSettings,
  replacementSettingsMutation,
  settingsOverrideView,
} from "./override-view";

test("replacement resets removed canonical fields without splitting desired atomic units", () => {
  const current = {
    model: { provider: "openai", modelId: "previous" },
    reasoningLevel: "high" as const,
    skills: { file: { "custom/name~": false } },
  };
  const desired = { model: { provider: "openai", modelId: "next" } };
  const mutation = replacementSettingsMutation(current, desired);
  assert.deepEqual(mutation.resets.sort(), [
    "/overrides/reasoningLevel",
    "/overrides/skills/file/custom~1name~0",
  ]);
  assert.deepEqual(
    applySettingsMutation(current, {
      expectedRevision: 1,
      expectedDigest: "a".repeat(64),
      ...mutation,
    }),
    desired,
  );
});

test("override views suppress old redundant choices without changing the document", () => {
  const own = {
    reasoningLevel: "off" as const,
    permissionRuleSetId: "autonomous",
  };
  assert.deepEqual(settingsOverrideView(own, own), {});
  assert.deepEqual(own, {
    reasoningLevel: "off",
    permissionRuleSetId: "autonomous",
  });
  assert.equal(settingsOverrideView(own, undefined), own);
});

test("draft edits clean existing redundancy and returning to the lower value inherits", () => {
  const inherited = {
    model: { provider: "openai", modelId: "base" },
    reasoningLevel: "off" as const,
    permissionRuleSetId: "autonomous",
    tools: { web_search: { enabled: true } },
    skills: { defaults: { file: true } },
    subagents: { coding: { enabled: true } },
  };
  const edited = mutateDraftSettings(
    inherited,
    { reasoningLevel: "high" },
    [],
    inherited,
  );
  assert.deepEqual(edited, { reasoningLevel: "high" });
  assert.deepEqual(
    mutateDraftSettings(edited, { reasoningLevel: "off" }, [], inherited),
    {},
  );
});

test("draft resets preserve independent tool choices", () => {
  const inherited = {
    tools: {
      bash: {
        settings: {
          maxTimeoutMs: 1000,
          autoPromotion: { enabled: true, afterMs: 120_000 },
        },
      },
    },
  };
  const own = {
    permissionRuleSetId: "read_only",
    tools: {
      bash: {
        settings: {
          maxTimeoutMs: 2000,
          autoPromotion: { enabled: true, afterMs: 120_000 },
        },
      },
    },
  };
  assert.deepEqual(
    mutateDraftSettings(own, {}, ["/overrides/permissionRuleSetId"], inherited),
    { tools: { bash: { settings: { maxTimeoutMs: 2000 } } } },
  );
});
