import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { agentProfilesDocumentSchema } from "@nervekit/contracts/agent-profiles";
import { permissionRuleSetSchema } from "@nervekit/contracts/permissions";
import {
  defaultHarnessConfig,
  harnessConfigSchema,
} from "@nervekit/contracts/settings";
import { runMigrations } from "../../framework/runner.js";
import { fixture, registry, timestamp } from "./step-fixture.js";
import { capabilityOverridesDocumentSchema } from "./capabilities.js";
import { mapProcessCall } from "./process-history.js";
import { convertProfileSettings } from "./configuration.js";

void test("0001 rewrites agent profile documents, conversation modes and profile trust", async (t) => {
  const home = await fixture(t);
  const legacyProfile = join(home, "config/subagents.json");
  writeFileSync(
    legacyProfile,
    JSON.stringify({
      schemaVersion: 1,
      profiles: {
        researcher: {
          model: "lead",
          thinking: "lead",
          permission: "read_only",
          compaction: {
            profile: "custom",
            triggerPercent: 75,
            keepRecentPercent: 20,
          },
          tools: { plan_mode_present: true },
        },
      },
    }),
  );
  const source = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    const row = source
      .prepare(
        "SELECT rowid, data FROM domain_documents WHERE namespace = 'conversation' LIMIT 1",
      )
      .get()!;
    const conversation = JSON.parse(
      Buffer.from(row.data as Uint8Array).toString(),
    );
    conversation.mode = "planning";
    source
      .prepare("UPDATE domain_documents SET data = ? WHERE rowid = ?")
      .run(Buffer.from(JSON.stringify(conversation)), row.rowid);
    source
      .prepare(
        "INSERT INTO domain_documents (namespace, document_id, data) VALUES (?, ?, ?)",
      )
      .run(
        "subagent_profile_trust",
        "old-profile-trust",
        Buffer.from(
          JSON.stringify({
            id: "old-profile-trust",
            path: legacyProfile,
            digest: "sha256:" + "a".repeat(64),
            createdAt: timestamp,
          }),
        ),
      );
  } finally {
    source.close();
  }
  await runMigrations(home, { registry });
  assert(!existsSync(legacyProfile));
  const profiles = agentProfilesDocumentSchema.parse(
    JSON.parse(readFileSync(join(home, "config/agent-profiles.json"), "utf8")),
  );
  assert.deepEqual(profiles.profiles.researcher, {
    model: "inherit",
    thinking: "inherit",
    usableBy: "subagent",
    permission: "read_only",
    compaction: { profile: "custom", triggerPercent: 75 },
    tools: { plan_present: true },
  });
  agentProfilesDocumentSchema.parse(
    JSON.parse(
      readFileSync(
        join(home, "project/.nerve/config/agent-profiles.json"),
        "utf8",
      ),
    ),
  );
  const output = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    assert.equal(
      output
        .prepare(
          "SELECT agent_profile FROM conversation_config WHERE agent_profile = 'planning'",
        )
        .all().length,
      1,
    );
    assert(
      !output
        .prepare("PRAGMA table_info(conversation_config)")
        .all()
        .some((column) => column.name === "mode"),
    );
    // The old coding/planning CHECK must not constrain custom profile names.
    output
      .prepare("UPDATE conversation_config SET agent_profile = 'custom-lead'")
      .run();
    const trust = output
      .prepare(
        "SELECT kind, path, status FROM trusted_resource WHERE kind = 'agent_profile'",
      )
      .get()!;
    assert.equal(trust.path, join(home, "config/agent-profiles.json"));
    assert.equal(
      trust.status,
      "rejected",
      "rewritten document requires renewed trust",
    );
  } finally {
    output.close();
  }
});

void test("stored harness and rule-set output validates without mode fields", () => {
  const harness = {
    ...structuredClone(defaultHarnessConfig),
    mode: "planning",
    lastSelection: {
      permissionRuleSetId: "supervised",
      thinkingLevel: "off",
      mode: "coding",
    },
    tools: {
      ...structuredClone(defaultHarnessConfig.tools),
      disabled: ["plan_mode_present", "web_fetch"],
    },
  };
  assert(convertProfileSettings(harness, "harness.json"));
  const parsed = harnessConfigSchema.parse(harness);
  assert.equal(parsed.lastSelection?.permissionRuleSetId, "supervised");
  assert.deepEqual(parsed.tools?.disabled, ["plan_present", "web_fetch"]);
  assert(!Object.hasOwn(harness, "mode"));
  assert(!Object.hasOwn(harness.lastSelection, "mode"));
  const ruleSet = {
    schemaVersion: 1,
    id: "custom",
    name: "Custom",
    source: "user",
    enabled: true,
    compatibleModes: ["coding"],
    rules: [
      {
        id: "ask",
        enabled: true,
        priority: 0,
        enforcement: "overridable",
        when: {},
        decision: "prompt",
      },
    ],
  };
  assert(convertProfileSettings(ruleSet, "custom.json", true));
  permissionRuleSetSchema.parse(ruleSet);
});

void test("plan tool names migrate in capability documents and transcript calls", () => {
  for (const schemaVersion of [1, 2]) {
    const document = capabilityOverridesDocumentSchema.parse({
      schemaVersion,
      tools: {
        plan_mode_present: schemaVersion === 1 ? true : { enabled: false },
      },
    });
    assert.deepEqual(document.tools, {
      plan_present: { enabled: schemaVersion === 1 },
    });
  }
  assert.deepEqual(
    mapProcessCall("plan_mode_present", { file_path: "plan.md" }),
    {
      name: "plan_present",
      args: { file_path: "plan.md" },
      generic: false,
    },
  );
});
