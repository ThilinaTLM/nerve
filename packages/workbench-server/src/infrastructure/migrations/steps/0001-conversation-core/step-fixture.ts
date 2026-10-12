import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TestContext } from "node:test";
import type { RegisteredStep } from "../../framework/step.js";
import step from "./step.js";

const baselineIds = [
  "0001-nerve-home-v1",
  "0002-atomic-run-lifecycle-work",
  "0003-authoritative-run-lifecycle",
  "0004-convert-run-lifecycle",
  "0005-async-subagent-completions",
  "0006-explore-agent-names",
  "0007-agent-async-obligations",
  "0008-tool-result-payload-reference",
  "0009-agent-async-obligations-backfill",
  "0010-deletion-indexes",
];
export const timestamp = "2026-01-01T00:00:00.000Z";
export const registry: RegisteredStep[] = [
  { step, checksum: "a".repeat(64), stage: "draft" },
];
export async function fixture(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-step-0001-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const directory of [
    "data/conversations/one",
    "data/tasks/task_old",
    "config",
    "agent/suggestions",
    "project",
    "cache",
    "migrations/0009-old",
  ])
    await mkdir(join(home, directory), { recursive: true });
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({ format: "nerve-home", version: 1 }),
  );
  await writeFile(
    join(home, "config/harness.json"),
    JSON.stringify({
      version: 3,
      defaults: { permissionLevel: "autonomous" },
      lastSelection: {
        permissionLevel: "read_only",
        permissionRuleSetId: "custom",
      },
      tools: {
        disabled: ["web_fetch", "explore", "subagent_new", "subagent_list"],
      },
      exploreAgent: {
        model: { provider: "fixture", modelId: "explorer" },
        thinkingLevel: "high",
      },
      asyncSubagent: {
        thinkingLevel: "low",
        compactionProfile: "custom",
        customTriggerPercent: 75,
        customKeepRecentPercent: 20,
      },
    }),
  );
  await writeFile(
    join(home, "config/settings.json"),
    JSON.stringify({
      defaultPermissionLevel: "supervised",
      lastAgentSelection: {
        permissionLevel: "autonomous",
        budget: { maxDepth: 3 },
        workspaceScope: { roots: [home] },
      },
    }),
  );
  await writeFile(
    join(home, "data/conversations/one/capabilities.json"),
    JSON.stringify({
      schemaVersion: 1,
      tools: { web_fetch: true, explore: true },
    }),
  );
  await mkdir(join(home, "data/reports/conversations/conv_one/batch_1"), {
    recursive: true,
  });
  await writeFile(
    join(
      home,
      "data/reports/conversations/conv_one/batch_1/01-task-agent_child.md",
    ),
    "# Explore report\n",
  );
  await writeFile(
    join(
      home,
      "data/reports/conversations/conv_one/batch_1/02-gone-agent_gone.md",
    ),
    "# Orphan report\n",
  );
  await writeFile(
    join(home, "data/conversations/one/permissions.json"),
    JSON.stringify({ schemaVersion: 2, overlays: [] }),
  );
  await writeFile(
    join(home, "data/tasks/task_old/stdout.txt"),
    "durable stdout\n",
  );
  const suggestion =
    "---\nname: fixture\nwhen:\n  permissionLevels: [autonomous]\nenable-js: |\n  return true;\n---\nPrompt body permissionLevels: stays untouched\n";
  await writeFile(join(home, "agent/suggestions/fixture.md"), suggestion);
  const cache = new DatabaseSync(join(home, "cache/query-cache.sqlite"));
  cache.exec("CREATE TABLE unrelated (id TEXT)");
  cache.close();
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    db.exec(`CREATE TABLE storage_migrations (id TEXT, ordinal INTEGER);
      CREATE TABLE domain_documents (namespace TEXT, scope_id TEXT, document_id TEXT, data BLOB);
      CREATE TABLE conversation_records (id TEXT PRIMARY KEY, conversation_id TEXT, agent_id TEXT, kind TEXT, sequence INTEGER, parent_id TEXT, run_id TEXT, created_at_ms INTEGER, data BLOB);
      CREATE TABLE agent_context_leaves (conversation_id TEXT, agent_id TEXT, active_record_id TEXT);
      CREATE TABLE file_assets (id TEXT, conversation_id TEXT, tool_call_id TEXT, logical_path TEXT, category TEXT, byte_length INTEGER, media_type TEXT, digest TEXT, created_at_ms INTEGER);`);
    baselineIds.forEach((id, index) =>
      db
        .prepare("INSERT INTO storage_migrations VALUES (?, ?)")
        .run(id, index + 1),
    );
    const document = (namespace: string, id: string, data: unknown) =>
      db
        .prepare("INSERT INTO domain_documents VALUES (?, 'global', ?, ?)")
        .run(namespace, id, Buffer.from(JSON.stringify(data)));
    document("project", "proj_fixture", {
      id: "proj_fixture",
      directory: join(home, "project"),
      createdAt: timestamp,
    });
    for (const name of ["one", "two"]) {
      document("conversation", `conv_${name}`, {
        id: `conv_${name}`,
        projectId: "proj_fixture",
        activeAgentId: `agent_${name}`,
        createdAt: timestamp,
      });
      document("agent", `agent_${name}`, {
        id: `agent_${name}`,
        conversationId: `conv_${name}`,
        model: { provider: "fixture", modelId: "model" },
        createdAt: timestamp,
      });
      const record = {
        entry: {
          id: `entry_${name}`,
          kind: "message",
          text: name,
          createdAt: timestamp,
        },
        modelContext: {
          entry: {
            id: `entry_${name}`,
            type: "message",
            parentId: null,
            message: { role: "user", content: name },
          },
        },
      };
      db.prepare(
        "INSERT INTO conversation_records VALUES (?, ?, ?, 'message', 1, NULL, NULL, 0, ?)",
      ).run(
        `entry_${name}`,
        `conv_${name}`,
        `agent_${name}`,
        Buffer.from(JSON.stringify(record)),
      );
      db.prepare(
        "INSERT INTO agent_context_leaves VALUES (?, 'agent_conversation', ?)",
      ).run(`conv_${name}`, `entry_${name}`);
    }
    document("agent", "agent_child", {
      id: "agent_child",
      conversationId: "conv_one",
      parentAgentId: "agent_one",
      workspaceScope: { roots: [home], readonly: true },
      tools: ["read"],
      createdAt: timestamp,
    });
    const child = {
      entry: {
        id: "entry_child",
        kind: "message",
        text: "child",
        createdAt: timestamp,
      },
      modelContext: {
        entry: {
          id: "entry_child",
          type: "message",
          parentId: null,
          message: { role: "user", content: "child" },
        },
      },
    };
    db.prepare(
      "INSERT INTO conversation_records VALUES ('entry_child', 'conv_one', 'agent_child', 'message', 2, NULL, NULL, 0, ?)",
    ).run(Buffer.from(JSON.stringify(child)));
    db.prepare(
      "INSERT INTO agent_context_leaves VALUES ('conv_one', 'agent_child', 'entry_child')",
    ).run();
    document("task", "task_old", {
      id: "task_old",
      conversationId: "conv_one",
      origin: { kind: "agent_tool", toolCallId: "tool_old" },
      command: "echo fixture",
      status: "running",
      stdoutPath: "tasks/task_old/stdout.txt",
      startedAt: timestamp,
    });
    document("task_definitions", "proj_fixture", [
      {
        id: "taskdef_fixture",
        scope: { kind: "project", projectId: "proj_fixture" },
        command: "echo fixture",
        runPolicy: "single",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    document("prompt_suggestion_enablement", "user:fixture", {
      definitionKey: "user:fixture",
      enabled: false,
    });
    document("prompt_suggestion_trust", "fixture", {
      trustId: "fixture",
      sourceKind: "user",
      path: "/old/home/agent/suggestions/fixture.md",
      name: "fixture",
      predicateHash: createHash("sha256").update("return true;").digest("hex"),
      status: "allowed",
      createdAt: timestamp,
    });
  } finally {
    db.close();
  }
  return home;
}
