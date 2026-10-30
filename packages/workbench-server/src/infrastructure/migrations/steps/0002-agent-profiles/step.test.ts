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
import { coreMigrations } from "@nervekit/conversation-core";
import { NodeAgentBrowserCommandRunner } from "../../../../core-host/agent-browser-skills.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import { createStepContext } from "../../framework/context.js";
import { sha256 } from "./released-format.js";
import step from "./step.js";
import { toolkitState } from "../../framework/toolkit.js";
import { currentMigrationArchive } from "./released-archive.js";

for (const damaged of [0, 1, 2, 3])
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
    if (damaged === 3)
      db.exec(`
      INSERT INTO conversation (id, project_id, title, status, status_event_sequence, paused, next_input_sequence, created_at, updated_at)
        VALUES ('parent', 'p', 'Parent', 'idle', 0, 0, 1, 'now', 'now');
      INSERT INTO conversation_config SELECT 'parent', model, reasoning_level, system_prompt, instructions, permission_rule_set_id, mode, working_directory FROM conversation_config WHERE conversation_id = 'c';
      UPDATE conversation SET parent_conversation_id = 'parent' WHERE id = 'c';
    `);
    if (damaged >= 2)
      db.exec(
        "UPDATE conversation_config SET model = '{}' WHERE conversation_id = 'c'",
      );
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
    if (damaged >= 2) {
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
    assert.equal(agent.overrides.tools.web_search.enabled, false);
    assert.deepEqual(agent.overrides.model, {
      provider: "test",
      modelId: "model",
    });
    assert.deepEqual(agent.context, {
      systemPrompt: "system",
      instructions: "instructions",
    });

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
