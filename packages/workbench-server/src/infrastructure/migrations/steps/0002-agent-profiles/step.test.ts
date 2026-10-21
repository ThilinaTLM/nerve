import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { agentProfilesDocumentSchema } from "@nervekit/contracts/agent-profiles";
import { permissionRuleSetSchema } from "@nervekit/contracts/permissions";
import {
  defaultHarnessConfig,
  harnessConfigSchema,
} from "@nervekit/contracts/settings";
import { openCoreStorage } from "@nervekit/conversation-core";
import { runMigrations } from "../../framework/runner.js";
import { rollbackFailedMigration } from "../../framework/recovery.js";
import {
  fixture,
  registry as legacyRegistry,
} from "../0001-conversation-core/step-fixture.js";
import step from "./step.js";
import { convertDocument, convertEventPayload } from "./documents.js";

const registry = [
  ...legacyRegistry,
  { step, checksum: "b".repeat(64), stage: "draft" as const },
];
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value));

async function releasedHome(t: Parameters<typeof fixture>[0]) {
  const home = await fixture(t);
  await runMigrations(home, { registry: legacyRegistry });
  return home;
}
function profiles(home: string) {
  const value = {
    schemaVersion: 1,
    profiles: {
      review: {
        model: "lead",
        thinking: "lead",
        permission: "read_only",
        compaction: {
          profile: "custom",
          triggerPercent: 75,
          keepRecentPercent: 20,
        },
        tools: { plan_mode_present: true },
        instructions: "Keep literal plan_mode_present prose.",
      },
    },
  };
  write(join(home, "config/subagents.json"), value);
  return value;
}

void test("an already-applied 0001 home runs 0002, then core v2, preserving user/project data", async (t) => {
  const home = await releasedHome(t);
  profiles(home);
  const harness = {
    ...structuredClone(defaultHarnessConfig),
    mode: "coding",
    lastSelection: { ...defaultHarnessConfig.lastSelection, mode: "planning" },
    tools: {
      ...structuredClone(defaultHarnessConfig.tools),
      disabled: ["plan_mode_present"],
    },
  };
  write(join(home, "config/harness.json"), harness);
  mkdirSync(join(home, "config/rule-sets"), { recursive: true });
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
  write(join(home, "config/rule-sets/custom.json"), ruleSet);
  const caps = join(
    home,
    "data/conversations/conv_one/config/capabilities.json",
  );
  write(caps, {
    schemaVersion: 2,
    tools: { plan_mode_present: { enabled: true } },
    skills: { file: {}, nerve: {}, agentBrowser: {} },
    toolSettings: {},
  });
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    db.prepare(
      "INSERT INTO trusted_resource VALUES ('profile-trust','subagent_profile',NULL,?,'Review','digest','trusted','now','now')",
    ).run(join(home, "config/subagents.json"));
    db.exec(
      "UPDATE conversation_config SET mode='planning' WHERE conversation_id='conv_one'",
    );
    db.exec(`INSERT INTO tool_call (id,conversation_id,turn_id,origin,tool_name,arguments,state,updated_at)
      VALUES ('plan-call','conv_one','turn','user','plan_mode_present','{}','ready','now')`);
  } finally {
    db.close();
  }
  await runMigrations(home, { registry });
  assert(!existsSync(join(home, "config/subagents.json")));
  const document = agentProfilesDocumentSchema.parse(
    read(join(home, "config/agent-profiles.json")),
  );
  assert.deepEqual(document.profiles.review, {
    model: "inherit",
    thinking: "inherit",
    permission: "read_only",
    usableBy: "subagent",
    compaction: { profile: "custom", triggerPercent: 75 },
    tools: { plan_present: true },
    instructions: "Keep literal plan_mode_present prose.",
  });
  agentProfilesDocumentSchema.parse(
    read(join(home, "project/.nerve/config/agent-profiles.json")),
  );
  assert.deepEqual(
    harnessConfigSchema.parse(read(join(home, "config/harness.json"))).tools
      .disabled,
    ["plan_present"],
  );
  permissionRuleSetSchema.parse(
    read(join(home, "config/rule-sets/custom.json")),
  );
  assert.deepEqual(read(caps).tools, { plan_present: { enabled: true } });
  // Home steps do not run SQL schema migrations or rewrite the released v1 receipt.
  const beforeCore = new DatabaseSync(join(home, "data/nerve.sqlite"));
  assert.equal(
    beforeCore.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.n,
    1,
  );
  beforeCore.close();
  const storage = openCoreStorage(join(home, "data/nerve.sqlite"));
  storage.close();
  const afterCore = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    assert.equal(
      afterCore
        .prepare(
          "SELECT agent_profile FROM conversation_config WHERE conversation_id='conv_one'",
        )
        .get()?.agent_profile,
      "planning",
    );
    assert.deepEqual(
      {
        ...afterCore
          .prepare(
            "SELECT kind,path,status FROM trusted_resource WHERE id='profile-trust'",
          )
          .get(),
      },
      {
        kind: "agent_profile",
        path: join(home, "config/agent-profiles.json"),
        status: "rejected",
      },
    );
    assert.equal(
      afterCore
        .prepare("SELECT tool_name FROM tool_call WHERE id='plan-call'")
        .get()?.tool_name,
      "plan_present",
    );
  } finally {
    afterCore.close();
  }
});

void test("legacy baseline runs 0001 → 0002 → core v2", async (t) => {
  const home = await fixture(t);
  await runMigrations(home, { registry });
  assert.deepEqual(
    read(join(home, "manifest.json")).migrations.map(
      (m: { id: string }) => m.id,
    ),
    ["0001-conversation-core", "0002-agent-profiles"],
  );
  const storage = openCoreStorage(join(home, "data/nerve.sqlite"));
  storage.close();
  agentProfilesDocumentSchema.parse(
    read(join(home, "config/agent-profiles.json")),
  );
});

void test("colliding JSON targets fail without overwriting either document", async (t) => {
  const home = await releasedHome(t);
  const original = profiles(home);
  const target = {
    schemaVersion: 1,
    profiles: { review: { model: "other/model" } },
  };
  write(join(home, "config/agent-profiles.json"), target);
  await assert.rejects(runMigrations(home, { registry }), /configuration file/);
  assert.deepEqual(read(join(home, "config/subagents.json")), original);
  assert.deepEqual(read(join(home, "config/agent-profiles.json")), target);
});

void test("receipts resume an interrupted step and rollback restores documents and SQL metadata", async (t) => {
  const home = await releasedHome(t);
  const original = profiles(home);
  const failing = [
    ...legacyRegistry,
    {
      ...registry[1],
      step: {
        ...step,
        async verify() {
          throw Error("interrupted after rewrite");
        },
      },
    },
  ];
  await assert.rejects(
    runMigrations(home, { registry: failing }),
    /interrupted/,
  );
  assert(!existsSync(join(home, "config/subagents.json")));
  await rollbackFailedMigration(home, { registry: failing });
  assert.deepEqual(read(join(home, "config/subagents.json")), original);
  assert(!existsSync(join(home, "config/agent-profiles.json")));
  await assert.rejects(
    runMigrations(home, { registry: failing }),
    /interrupted/,
  );
  await runMigrations(home, { registry });
  assert.equal(read(join(home, "manifest.json")).migrations.at(-1).id, step.id);
});

void test("profile paths cannot redirect conversion through symlinks", async (t) => {
  const home = await releasedHome(t);
  const original = profiles(home);
  const outside = join(home, "outside.json");
  write(outside, { schemaVersion: 1, profiles: {} });
  symlinkSync(outside, join(home, "config/agent-profiles.json"));
  await assert.rejects(runMigrations(home, { registry }), /configuration file/);
  assert.deepEqual(read(join(home, "config/subagents.json")), original);
  assert.deepEqual(read(outside), { schemaVersion: 1, profiles: {} });
});

void test("named tool projections and settings migrate without rewriting prose or arguments", () => {
  const payload = {
    content: [
      { type: "text", text: "plan_mode_present" },
      {
        type: "toolCall",
        name: "plan_mode_present",
        arguments: { name: "plan_mode_present" },
      },
    ],
    toolName: "plan_mode_present",
    userProjection: {
      toolName: "plan_mode_present",
      argsPreview: { toolName: "plan_mode_present" },
    },
  };
  const converted = convertEventPayload(payload) as typeof payload;
  assert.equal(converted.content[0].text, "plan_mode_present");
  assert.equal(converted.content[1].name, "plan_present");
  assert.equal(converted.content[1].arguments?.name, "plan_mode_present");
  assert.equal(converted.userProjection.toolName, "plan_present");
  assert.equal(
    converted.userProjection.argsPreview.toolName,
    "plan_mode_present",
  );
  assert.deepEqual(
    convertDocument(
      { lastAgentSelection: { mode: "planning", model: "a/b" } },
      "ui",
    ),
    { lastAgentSelection: { model: "a/b" } },
  );
  assert.deepEqual(convertDocument({ tools: { disabled: [] } }, "harness"), {
    tools: { disabled: ["plan_present"] },
  });
  assert.throws(
    () =>
      convertDocument(
        { tools: { plan_mode_present: true, plan_present: false } },
        "capabilities",
      ),
    /Conflicting/,
  );
});
