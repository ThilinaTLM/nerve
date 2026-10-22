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
import {
  agentProfileFileSchema,
  appliedAgentProfileSchema,
} from "@nervekit/contracts/agent-profiles";
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
import { digest } from "./files.js";
import type { MigrationProgress } from "../../framework/step.js";

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
        description: "Fixture review",
        skills: "inherit",
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
    version: 3,
    defaultAgentProfile: "planning",
    mode: "coding",
    lastSelection: { ...defaultHarnessConfig.lastSelection, mode: "planning" },
    tools: {
      bash: {
        maxTimeoutMs: 300000,
        autoPromotion: { enabled: true, afterMs: 10000 },
      },
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
    db.prepare(`INSERT INTO tool_call (id,conversation_id,turn_id,origin,tool_name,arguments,state,interaction,updated_at)
      VALUES ('plan-call','conv_one','turn','user','plan_mode_present','{}','awaiting_input',?,'now')`).run(
      JSON.stringify({
        kind: "plan_review",
        request: { assetId: "plan-fixture", path: "plan.md" },
      }),
    );
  } finally {
    db.close();
  }
  await runMigrations(home, { registry });
  assert(!existsSync(join(home, "config/subagents.json")));
  assert(!existsSync(join(home, "config/agent-profiles.json")));
  const profile = agentProfileFileSchema.parse(
    read(join(home, "data/agent-profiles/review.json")),
  );
  assert.equal(profile.model, "lead");
  assert.equal(profile.skills, "lead");
  assert.deepEqual(profile.permission, { set: "read_only" });
  assert.deepEqual(profile.compaction, {
    set: { auto: true, profile: "custom", customTriggerPercent: 75 },
  });
  assert.deepEqual(profile.tools?.plan_present, {
    set: { enabled: true, settings: { approvalProfile: "coding" } },
  });
  assert.equal(profile.instructions, "Keep literal plan_mode_present prose.");
  agentProfileFileSchema.parse(
    read(join(home, "project/.nerve/agent-profiles/reviewer.json")),
  );
  const migratedHarness = harnessConfigSchema.parse(
    read(join(home, "config/harness.json")),
  );
  assert.equal(migratedHarness.version, 4);
  assert.equal(migratedHarness.tools.plan_present?.enabled, false);
  assert(!("execution" in migratedHarness));
  const applied = appliedAgentProfileSchema.parse(
    read(
      join(
        home,
        "data/conversations/conv_one/config/applied-agent-profile.json",
      ),
    ),
  );
  assert.equal(applied.name, "planning");
  assert.equal(applied.locked.permission, "planning");
  permissionRuleSetSchema.parse(
    read(join(home, "config/rule-sets/custom.json")),
  );
  assert.equal(read(caps).schemaVersion, 3);
  assert.deepEqual(read(caps).tools.plan_present, {
    enabled: true,
    settings: { approvalProfile: "coding" },
  });
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
    const interaction = JSON.parse(
      String(
        afterCore
          .prepare("SELECT interaction FROM tool_call WHERE id='plan-call'")
          .get()?.interaction,
      ),
    );
    assert.equal(
      interaction.request.approvalProfile,
      "coding",
      "review captures tool config rather than the planning start profile",
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
  agentProfileFileSchema.parse(
    read(join(home, "data/agent-profiles/explore.json")),
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
  const setupDb = new DatabaseSync(join(home, "data/nerve.sqlite"));
  setupDb.exec(
    "UPDATE conversation_config SET mode='planning' WHERE conversation_id='conv_one'",
  );
  const beforeConfig = {
    ...setupDb
      .prepare(
        "SELECT * FROM conversation_config WHERE conversation_id='conv_one'",
      )
      .get(),
  };
  setupDb.close();
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
  assert(
    !existsSync(
      join(
        home,
        "data/conversations/conv_one/config/applied-agent-profile.json",
      ),
    ),
  );
  const restoredDb = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  assert.deepEqual(
    {
      ...restoredDb
        .prepare(
          "SELECT * FROM conversation_config WHERE conversation_id='conv_one'",
        )
        .get(),
    },
    beforeConfig,
  );
  restoredDb.close();
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

void test("per-file output collisions after an interrupted split are never overwritten", async (t) => {
  const home = await releasedHome(t);
  profiles(home);
  const failing = [
    ...legacyRegistry,
    {
      ...registry[1],
      step: {
        ...step,
        async verify() {
          throw Error("interrupted after phase5");
        },
      },
    },
  ];
  await assert.rejects(
    runMigrations(home, { registry: failing }),
    /interrupted/,
  );
  const path = join(home, "data/agent-profiles/review.json");
  const changed = { ...read(path), instructions: "External target edit" };
  write(path, changed);
  await assert.rejects(runMigrations(home, { registry }), /configuration file/);
  assert.deepEqual(read(path), changed);
  await rollbackFailedMigration(home, { registry });
  assert(existsSync(join(home, "config/subagents.json")));
  assert(!existsSync(path));
});

void test("genuinely ambiguous both-scope inheritance requires repair and can be rolled back", async (t) => {
  const home = await fixture(t);
  await runMigrations(home, { registry: legacyRegistry });
  const original = read(join(home, "config/subagents.json"));
  original.profiles.developer.usableBy = "both"; // Inheritance has different lead/child semantics.
  write(join(home, "config/subagents.json"), original);
  await assert.rejects(runMigrations(home, { registry }), /configuration file/);
  assert.match(
    readFileSync(join(home, "migrations/last-failure.json"), "utf8"),
    /ambiguous/,
  );
  await rollbackFailedMigration(home, { registry });
  assert.deepEqual(read(join(home, "config/subagents.json")), original);
});

void test("already-materialized child values are snapshotted without applying the edited template again", async (t) => {
  const home = await releasedHome(t);
  const core = openCoreStorage(join(home, "data/nerve.sqlite"));
  core.close();
  write(join(home, "config/subagents.json"), {
    schemaVersion: 1,
    profiles: {
      fixed: {
        description: "Fixed child",
        usableBy: "subagent",
        enabled: true,
        model: { lock: "fixture/edited-template" },
        thinking: { lock: "high" },
        permission: { lock: "read_only" },
        compaction: "inherit",
        tools: {},
        skills: "inherit",
        instructions: "Edited template instructions",
      },
    },
  });
  const database = new DatabaseSync(join(home, "data/nerve.sqlite"));
  const childId = String(
    database
      .prepare(
        "SELECT id FROM conversation WHERE parent_conversation_id IS NOT NULL LIMIT 1",
      )
      .get()?.id,
  );
  database
    .prepare(
      "UPDATE conversation_config SET agent_profile='fixed',model=?,reasoning_level='off',permission_rule_set_id='autonomous',instructions=? WHERE conversation_id=?",
    )
    .run(
      JSON.stringify({ provider: "fixture", modelId: "created-child" }),
      "Captured child instructions",
      childId,
    );
  database.close();
  await runMigrations(home, { registry });
  const applied = appliedAgentProfileSchema.parse(
    read(
      join(
        home,
        "data/conversations",
        childId,
        "config/applied-agent-profile.json",
      ),
    ),
  );
  assert.equal(applied.instructions, "Captured child instructions");
  assert.deepEqual(applied.locked.model, {
    provider: "fixture",
    modelId: "created-child",
  });
  assert.equal(applied.locked.thinking, "off");
  assert.equal(applied.locked.permission, "autonomous");
  const after = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    after
      .prepare(
        "SELECT instructions FROM conversation_config WHERE conversation_id=?",
      )
      .get(childId)?.instructions,
    null,
  );
  after.close();
});

void test("inherited model plus explicit thinking migrates without repair and mixed lock modes stay independent", async (t) => {
  const home = await releasedHome(t);
  const source = read(join(home, "config/subagents.json"));
  source.profiles.developer.thinking = "high";
  source.profiles.explore.model = { lock: "fixture/fixed" };
  source.profiles.explore.thinking = "inherit";
  write(join(home, "config/subagents.json"), source);
  await runMigrations(home, { registry });
  const developer = agentProfileFileSchema.parse(
    read(join(home, "data/agent-profiles/developer.json")),
  );
  assert.equal(developer.model, "lead");
  assert.deepEqual(developer.thinking, { set: "high" });
  const explore = agentProfileFileSchema.parse(
    read(join(home, "data/agent-profiles/explore.json")),
  );
  assert.deepEqual(explore.model, {
    lock: { provider: "fixture", modelId: "fixed" },
  });
  assert.equal(explore.thinking, "lead");
});

void test("0002 reports real conversation progress and reuses its durable plan receipt", async (t) => {
  const home = await releasedHome(t);
  const reports: MigrationProgress[] = [];
  let checkedReceipt = false;
  await runMigrations(home, {
    registry,
    onProgress(progress) {
      reports.push(progress);
      if (progress.phase === "conversation-database") {
        const scratch = join(home, "migrations/work", step.id);
        const plan = read(
          join(scratch, `phase5-conversation-${digest("conv_one")}.json`),
        );
        assert(plan.sourceHashes);
        assert(plan.outputs);
        assert(
          !existsSync(
            join(scratch, `phase5-${digest("conversation:conv_one")}.json`),
          ),
          "must not write a duplicate batch receipt",
        );
        checkedReceipt = true;
      }
    },
  });
  assert(checkedReceipt);
  const conversations = reports.filter(
    (report) => report.phase === "conversations",
  );
  assert.equal(conversations[0]?.done, 0);
  assert.equal(conversations.at(-1)?.done, conversations.at(-1)?.total);
  assert((conversations.at(-1)?.total ?? 0) > 0);
  assert(reports.some((report) => report.phase === "backup"));
  assert(reports.some((report) => report.phase === "verify-receipts"));
  assert(reports.some((report) => report.phase === "verify-conversations"));
  const afterConversations = reports.slice(
    reports.lastIndexOf(conversations.at(-1)!) + 1,
  );
  assert(
    afterConversations.every((report) => report.done === undefined),
    "verification must not reset the meter",
  );
});

void test("conversation plan receipts still detect changed output and allow rollback", async (t) => {
  const home = await releasedHome(t);
  const path = join(
    home,
    "data/conversations/conv_one/config/applied-agent-profile.json",
  );
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress(progress) {
        if (progress.phase === "verify-receipts") {
          const value = read(path);
          value.instructions += "changed after conversion";
          write(path, value);
        }
      },
    }),
    /Changed phase-5 output/,
  );
  await rollbackFailedMigration(home, { registry });
  assert(!existsSync(path));
});

void test("failed conversation units are not reported as completed", async (t) => {
  const home = await releasedHome(t);
  write(
    join(home, "data/conversations/conv_one/config/applied-agent-profile.json"),
    { schemaVersion: 0 },
  );
  const reports: MigrationProgress[] = [];
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: (progress) => reports.push(progress),
    }),
    /conversation/,
  );
  const conversations = reports.filter(
    (report) => report.phase === "conversations",
  );
  assert(conversations.length > 0);
  assert(conversations.every((report) => report.done! < report.total!));
});
