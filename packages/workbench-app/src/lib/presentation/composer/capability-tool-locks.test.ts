import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityToolLocks,
  canonicalSettingRequired,
  requiredCanonicalPointers,
  editableToolOverrideResets,
} from "./capability-tool-locks";

void test("Required configuration does not lock a Recommended enabled switch", () => {
  assert.deepEqual(
    capabilityToolLocks(["jira"], {
      "/tools/jira/profileId": { source: "requirement", profile: "planning" },
      "/tools/jira/enabled": { source: "recommendation", profile: "planning" },
    }),
    { enabledBy: undefined },
  );
});

void test("Required enabled does not lock unrelated editable configuration", () => {
  assert.deepEqual(
    capabilityToolLocks(["jira"], {
      "/tools/jira/enabled": { source: "requirement", profile: "planning" },
      "/tools/jira/profileId": {
        source: "recommendation",
        profile: "planning",
      },
    }),
    { enabledBy: "planning" },
  );
});

void test("only exact enabled units in the selected group lock switches", () => {
  assert.deepEqual(
    capabilityToolLocks(["read_file", "list_files"], {
      "/tools/jira/enabled": { source: "requirement", profile: "planning" },
      "/tools/read_file/enabled": { source: "project" },
      "/tools/list_files/enabled": { source: "user" },
    }),
    { enabledBy: undefined },
  );
  assert.equal(
    capabilityToolLocks(["read_file", "list_files"], {
      "/tools/list_files/enabled": {
        source: "requirement",
        profile: "planning",
      },
    }).enabledBy,
    "planning",
  );
});

void test("Required vision model leaves reasoning editable; atomic settings lock descendants only", () => {
  const required = requiredCanonicalPointers({
    "/tools/explain_image/settings/model": {
      source: "requirement",
      profile: "planning",
    },
    "/tools/explain_image/settings/thinkingLevel": {
      source: "recommendation",
      profile: "planning",
    },
    "/tools/generate_image/settings": {
      source: "requirement",
      profile: "planning",
    },
    "/tools/bash/settings/autoPromotion": {
      source: "requirement",
      profile: "planning",
    },
  });
  assert.equal(
    canonicalSettingRequired("/tools/explain_image/settings/model", required),
    true,
  );
  assert.equal(
    canonicalSettingRequired(
      "/tools/explain_image/settings/thinkingLevel",
      required,
    ),
    false,
  );
  assert.equal(
    canonicalSettingRequired(
      "/tools/generate_image/settings/options/size",
      required,
    ),
    true,
  );
  assert.equal(
    canonicalSettingRequired("/tools/generate_image/enabled", required),
    false,
  );
  assert.equal(
    canonicalSettingRequired(
      "/tools/bash/settings/autoPromotion/afterMs",
      required,
    ),
    true,
  );
  assert.equal(
    canonicalSettingRequired("/tools/bash/settings/shellPath", required),
    false,
  );
  assert.equal(
    canonicalSettingRequired("/tools/bash/settings/maxTimeoutMs", required),
    false,
  );
});

void test("Required enabled leaves editable config marked and resettable without resetting hidden choices", () => {
  const overrides = {
    tools: {
      jira: { enabled: false, profileId: "local-account" },
      confluence: { profileId: "unrelated-account" },
    },
  };
  const provenance = {
    "/tools/jira/enabled": {
      source: "requirement" as const,
      profile: "planning",
    },
  };
  assert.deepEqual(
    editableToolOverrideResets(["jira"], overrides, provenance),
    ["/overrides/tools/jira/profileId"],
  );
  assert.deepEqual(
    editableToolOverrideResets(["jira"], overrides, {
      ...provenance,
      "/tools/jira/profileId": { source: "requirement", profile: "planning" },
    }),
    [],
  );
});

void test("row resets preserve atomic required settings and reset editable siblings only", () => {
  assert.deepEqual(
    editableToolOverrideResets(
      ["bash"],
      {
        tools: {
          bash: {
            settings: {
              autoPromotion: { enabled: false, afterMs: 1000 },
              shellPath: "/bin/sh",
              maxTimeoutMs: 10000,
            },
          },
        },
      },
      {
        "/tools/bash/settings/autoPromotion": {
          source: "requirement",
          profile: "planning",
        },
        "/tools/bash/settings/shellPath": {
          source: "recommendation",
          profile: "planning",
        },
      },
    ),
    [
      "/overrides/tools/bash/settings/shellPath",
      "/overrides/tools/bash/settings/maxTimeoutMs",
    ],
  );
});
