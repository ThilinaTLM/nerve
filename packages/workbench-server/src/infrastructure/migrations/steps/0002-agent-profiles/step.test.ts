import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  toolCallSchema,
  toolCallResponsePayloadSchema,
} from "@nervekit/contracts/core";
import {
  eventConfirmationReason,
  callConfirmationReason,
  requestBindingReason,
} from "./released-metadata.js";
import { coreMigrations } from "@nervekit/conversation-core";
import { NodeAgentBrowserCommandRunner } from "../../../../core-host/agent-browser-skills.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import { createStepContext } from "../../framework/context.js";
import { sha256 } from "./released-format.js";
import step from "./step.js";
import { toolkitState } from "../../framework/toolkit.js";
import { currentMigrationArchive } from "./released-archive.js";

for (const damaged of [0, 1, 2, 3, 4])
  void test(`home conversion isolates project configuration and damaged home documents (${damaged})`, async (t) => {
    const home = mkdtempSync(join(tmpdir(), "nerve-home-only-0002-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    t.mock.method(NodeAgentBrowserCommandRunner.prototype, "run", async () =>
      JSON.stringify({ data: [] }),
    );
    const paths = storagePaths(home);
    mkdirSync(join(home, "data"), { recursive: true });
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(paths.manifestPath, JSON.stringify({ migrations: [] }));
    const project = join(home, "project");
    const projectFiles = [
      "config/harness.json",
      "config/capabilities.json",
      "config/subagents.json",
      "config/integrations.json",
      "config/permissions.json",
      "agent-profiles/review.json",
    ].map((file) => join(project, ".nerve", file));
    for (const file of projectFiles) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "invalid project bytes");
    }
    const db = new DatabaseSync(paths.sqlitePath);
    const v1 = coreMigrations.find((migration) => migration.version === 1)!;
    db.exec(
      `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;`,
    );
    db.exec(v1.sql);
    db.prepare(
      "INSERT INTO schema_migrations VALUES (1, ?, ?, 'original')",
    ).run(v1.name, sha256(v1.sql));
    db.prepare(
      "INSERT INTO project VALUES ('p', 'Project', ?, 'now', 'now')",
    ).run(project);
    db.exec(`INSERT INTO conversation (id, project_id, title, status, status_event_sequence, paused, next_input_sequence, created_at, updated_at)
    VALUES ('c', 'p', 'Conversation', 'idle', 0, 0, 1, 'now', 'now');
    INSERT INTO conversation_config VALUES ('c', '{"provider":"test","modelId":"model"}', 'high', 'system', 'instructions', 'planning', 'coding', '/project');`);
    if (damaged === 3 || damaged === 4)
      db.exec(`
      INSERT INTO conversation (id, project_id, title, status, status_event_sequence, paused, next_input_sequence, created_at, updated_at)
        VALUES ('parent', 'p', 'Parent', 'idle', 0, 0, 1, 'now', 'now');
      INSERT INTO conversation_config SELECT 'parent', model, reasoning_level, system_prompt, instructions, permission_rule_set_id, mode, working_directory FROM conversation_config WHERE conversation_id = 'c';
      UPDATE conversation SET parent_conversation_id = 'parent' WHERE id = 'c';
    `);
    if (damaged === 2 || damaged === 3)
      db.exec(
        "UPDATE conversation_config SET model = '{}' WHERE conversation_id = 'c'",
      );
    const review = {
      kind: "plan_review",
      request: {
        assetId: "plan",
        path: "plans/fixture.md",
        approvalProfile: "planning",
      },
      resolution: { kind: "plan_review", decision: "approve" },
    };
    const payload = {
      toolCallId: "review",
      toolName: "plan_present",
      providerCallId: null,
      arguments: {},
      origin: "user",
      assistantEventId: null,
      contentIndex: null,
      outcome: "completed",
      agentProjection: [],
      userProjection: { argsPreview: {}, resultPreview: null },
      supervision: null,
      interactionResolution: review.resolution,
      resolutionRequestId: "r",
      assetIds: [],
    };
    db.prepare(
      "INSERT INTO conversation_event VALUES ('review-event', 'c', 1, NULL, 'tool_call_response', 'none', NULL, NULL, ?, '2026-10-30T00:00:00.000Z')",
    ).run(JSON.stringify(payload));
    db.prepare(
      "INSERT INTO tool_call VALUES ('review', 'c', 'turn', NULL, NULL, NULL, 'user', 'plan_present', '{}', 'ready', NULL, ?, NULL, '2026-10-30T00:00:00.000Z')",
    ).run(JSON.stringify(review));
    db.close();
    const own = join(home, "data/conversations/c/config");
    mkdirSync(own, { recursive: true });
    writeFileSync(
      join(own, "capabilities.json"),
      JSON.stringify({
        schemaVersion: 2,
        tools: { web_search: { enabled: false } },
      }),
    );
    // v0.37.0 ConversationHarnessSettings wrote compaction-only JSON, no version.
    const compaction = {
      auto: false,
      profile: "custom",
      customTriggerPercent: 63,
    };
    writeFileSync(join(own, "harness.json"), JSON.stringify({ compaction }));
    const damagedFiles = [
      join(home, "config/harness.json"),
      join(home, "config/permissions.json"),
      join(own, "harness.json"),
      join(own, "permissions.json"),
    ];
    if (damaged === 1)
      for (const file of damagedFiles) writeFileSync(file, "broken JSON");
    const { context } = createStepContext(
      paths,
      "0002-agent-profiles",
      "Home only",
      () => {},
    );
    await step.run(context);
    await step.verify!(context);
    const migratedDb = new DatabaseSync(paths.sqlitePath, { readOnly: true });
    try {
      assert.equal(
        migratedDb
          .prepare("SELECT count(*) AS n FROM conversation_reference")
          .get()?.n,
        0,
      );
      assert.deepEqual(
        migratedDb
          .prepare("PRAGMA foreign_key_list(conversation_reference)")
          .all()
          .map((row) => ({ ...row })),
        [
          {
            id: 0,
            seq: 0,
            table: "conversation",
            from: "conversation_id",
            to: "id",
            on_update: "NO ACTION",
            on_delete: "CASCADE",
            match: "NONE",
          },
        ],
      );
      const reviewedReferenceSql = coreMigrations
        .find((migration) => migration.version === 2)!
        .sql.match(
          /CREATE TABLE conversation_reference \([\s\S]*?\) STRICT;/,
        )![0];
      assert.equal(
        migratedDb
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE name='conversation_reference'",
          )
          .get()?.sql,
        reviewedReferenceSql.slice(0, -1),
      );
      const event = toolCallResponsePayloadSchema.parse(
        JSON.parse(
          String(
            migratedDb
              .prepare(
                "SELECT payload FROM conversation_event WHERE id='review-event'",
              )
              .get()!.payload,
          ),
        ),
      );
      const row = migratedDb
        .prepare("SELECT * FROM tool_call WHERE id='review'")
        .get()!;
      const call = toolCallSchema.parse({
        id: row.id,
        conversationId: row.conversation_id,
        turnId: row.turn_id,
        providerCallId: row.provider_call_id,
        assistantEventId: row.assistant_event_id,
        contentIndex: row.content_index,
        origin: row.origin,
        toolName: row.tool_name,
        arguments: JSON.parse(String(row.arguments)),
        state: row.state,
        supervision: null,
        interaction: JSON.parse(String(row.interaction)),
        executionClaim: null,
        updatedAt: row.updated_at,
      });
      assert.deepEqual(
        event.interactionResolution,
        call.interaction?.resolution,
      );
      assert.equal(call.interaction?.kind, "plan_review");
      if (
        call.interaction?.kind === "plan_review" &&
        call.interaction.resolution?.decision === "approve"
      ) {
        assert.deepEqual(
          call.interaction.resolution.confirmation.targetProfile,
          call.interaction.request.targetProfile,
        );
        assert.equal(call.interaction.request.targetProfile.name, "planning");
      }
    } finally {
      migratedDb.close();
    }
    for (const reason of [
      eventConfirmationReason,
      callConfirmationReason,
      requestBindingReason,
    ])
      assert.equal(
        toolkitState(context).losses.find((loss) => loss.reason === reason)
          ?.count,
        1,
      );
    if (damaged === 1) {
      const items = toolkitState(context).setAside;
      assert.equal(items.length, damagedFiles.length);
      for (const file of damagedFiles) {
        const item = items.find((item) => item.id === file)!;
        assert.ok(item, file);
        assert.equal(
          readFileSync(
            join(item.quarantinePath, "payload", file.split("/").at(-1)!),
            "utf8",
          ),
          "broken JSON",
        );
        assert.equal(readFileSync(file, "utf8"), "broken JSON");
      }
    }
    for (const file of projectFiles)
      assert.equal(readFileSync(file, "utf8"), "invalid project bytes");
    const agent = JSON.parse(readFileSync(join(own, "agent.json"), "utf8"));
    if (damaged === 2 || damaged === 3) {
      assert.match(
        (agent.frozenDefaults ?? agent.overrides).permissionRuleSetId,
        /^migration-set-aside-/,
      );
      const item = toolkitState(context).setAside.find(
        (item) => item.kind === "conversation",
      )!;
      assert.ok(item);
      assert.ok(
        readFileSync(
          join(item.quarantinePath, "payload/records.jsonl"),
          "utf8",
        ).includes('"model":"{}"'),
      );
      return;
    }
    const settings = agent.frozenDefaults ?? agent.overrides;
    if (damaged === 0 || damaged === 4) {
      assert.deepEqual(settings.compaction, compaction);
      assert.deepEqual(toolkitState(context).setAside, []);
    }
    assert.equal(settings.tools.web_search.enabled, false);
    assert.deepEqual(settings.model, {
      provider: "test",
      modelId: "model",
    });
    assert.deepEqual(agent.context, {
      systemPrompt: "system",
      instructions: "instructions",
    });

    if (damaged === 0) {
      const changedDb = new DatabaseSync(paths.sqlitePath);
      try {
        changedDb.exec(
          "INSERT INTO conversation_reference VALUES ('c', 'github', 'github.com/acme/api#1', 'issue', 'referenced', 'review-event', 'now')",
        );
        await assert.rejects(
          step.verify!(context),
          /New table must be empty: conversation_reference/,
        );
        changedDb.exec("DROP TABLE conversation_reference");
        await assert.rejects(step.verify!(context), /table set/);
        changedDb.exec(
          coreMigrations
            .find((migration) => migration.version === 2)!
            .sql.match(
              /CREATE TABLE conversation_reference \([\s\S]*?\) STRICT;/,
            )![0],
        );
        await step.verify!(context);
      } finally {
        changedDb.close();
      }
    }

    // An archive created by the previous implementation must not replay project IO.
    const planPath = join(
      currentMigrationArchive(home)!.directory,
      "plan.json",
    );
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    plan.receipts[0].receipt.identity = `scope:${join(project, ".nerve")}`;
    writeFileSync(planPath, JSON.stringify(plan));
    await assert.rejects(step.run(context), /contains project receipts/);
    for (const file of projectFiles)
      assert.equal(readFileSync(file, "utf8"), "invalid project bytes");
  });
