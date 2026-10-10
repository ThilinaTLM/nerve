import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { runMigrations } from "../../framework/runner.js";
import type { RegisteredStep, StepContext } from "../../framework/step.js";
import step from "./step.js";
import { coreSchemaV1 } from "./schema.js";

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
const timestamp = "2026-01-01T00:00:00.000Z";
const registry: RegisteredStep[] = [
  { step, checksum: "a".repeat(64), stage: "draft" },
];
async function fixture(t: TestContext): Promise<string> {
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
      tools: { disabled: ["web_fetch"] },
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
    JSON.stringify({ schemaVersion: 1, tools: { web_fetch: true } }),
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

void test("0001 converts a baseline, preserves outputs/configuration and records only after verification", async (t) => {
  const home = await fixture(t);
  await runMigrations(home, { registry });
  const manifest = JSON.parse(
    await readFile(join(home, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.version, 2);
  assert.equal(manifest.migrations.length, 1);
  assert.equal(existsSync(join(home, "data/nerve.sqlite.migrating")), false);
  assert.equal(existsSync(join(home, "data/tasks")), false);
  assert.equal(existsSync(join(home, "cache/query-cache.sqlite")), false);
  assert.equal(existsSync(join(home, "migrations/0009-old")), false);
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM conversation").get()!.n,
      3,
    );
    assert.equal(
      db.prepare("SELECT checksum FROM schema_migrations").get()!.checksum,
      createHash("sha256").update(coreSchemaV1).digest("hex"),
    );
    const child = db
      .prepare(
        "SELECT c.id, cfg.permission_rule_set_id FROM conversation c JOIN conversation_config cfg ON c.id = cfg.conversation_id WHERE parent_conversation_id IS NOT NULL",
      )
      .get()!;
    assert.equal(child.permission_rule_set_id, "read_only");
    const childCaps = JSON.parse(
      await readFile(
        join(
          home,
          "data/conversations",
          String(child.id),
          "config/capabilities.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(childCaps.tools.explore, { enabled: false });
    const output = db.prepare("SELECT logical_path FROM asset").get()!;
    assert.equal(
      await readFile(join(home, "data", String(output.logical_path)), "utf8"),
      "durable stdout\n",
    );
    assert.equal(
      db.prepare("SELECT status FROM async_bash").get()!.status,
      "lost",
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM trusted_resource WHERE kind = 'prompt_suggestion' AND status = 'trusted'",
        )
        .get()!.n,
      1,
    );
  } finally {
    db.close();
  }
  const harness = JSON.parse(
    await readFile(join(home, "config/harness.json"), "utf8"),
  );
  assert.deepEqual(harness.defaults, { permissionRuleSetId: "autonomous" });
  assert.deepEqual(harness.lastSelection, { permissionRuleSetId: "custom" });
  const settings = JSON.parse(
    await readFile(join(home, "config/settings.json"), "utf8"),
  );
  assert.deepEqual(settings, {
    defaultPermissionRuleSetId: "supervised",
    lastAgentSelection: { permissionRuleSetId: "autonomous" },
  });
  const cap = JSON.parse(
    await readFile(
      join(home, "data/conversations/conv_one/config/capabilities.json"),
      "utf8",
    ),
  );
  assert.equal(cap.schemaVersion, 2);
  assert.deepEqual(cap.tools.web_fetch, { enabled: true });
  assert.equal(
    (
      await readFile(join(home, "agent/suggestions/fixture.md"), "utf8")
    ).includes("  permissionRuleSets: [autonomous]"),
    true,
  );
  assert.equal(
    (
      await readFile(join(home, "agent/suggestions/fixture.md"), "utf8")
    ).includes("Prompt body permissionLevels: stays untouched"),
    true,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(home, "config/prompt-suggestions.json"), "utf8"),
    ).enabled,
    { "user:fixture": false },
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(home, "project/.nerve/tasks/definitions.json"),
        "utf8",
      ),
    ).definitions.length,
    1,
  );
  assert.deepEqual(
    (await runMigrations(home, { registry, dryRun: true })).pending,
    [],
  );
});

void test("0001 resumes by discarding a partially imported new database", async (t) => {
  const home = await fixture(t);
  let interrupted = false;
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: ({ phase, done }) => {
        if (phase === "import" && done === 1) {
          interrupted = true;
          throw new Error("simulated crash mid-import");
        }
      },
    }),
    /simulated crash mid-import/,
  );
  assert(interrupted);
  assert(existsSync(join(home, "data/nerve.sqlite.migrating")));
  assert.deepEqual(
    JSON.parse(await readFile(join(home, "manifest.json"), "utf8")).migrations,
    [],
  );
  await runMigrations(home, { registry });
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM conversation").get()!.n,
      3,
    );
  } finally {
    db.close();
  }
  assert.equal(existsSync(join(home, "data/nerve.sqlite.migrating")), false);
});

void test("0001 verification failure keeps the source and task bundles; verified cleanup resumes before ledger", async (t) => {
  const home = await fixture(t);
  let context: StepContext | undefined;
  const captured = {
    ...step,
    async run(ctx: StepContext) {
      context = { ...ctx, log() {} };
      await step.run(ctx);
    },
  };
  await assert.rejects(
    runMigrations(home, {
      registry: [{ ...registry[0], step: captured }],
      onProgress: ({ phase }) => {
        if (phase === "verify") {
          const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
          try {
            db.exec(
              "UPDATE conversation_event SET payload = json_set(payload, '$.text', 'corrupted') WHERE conversation_id = 'conv_one'",
            );
          } finally {
            db.close();
          }
        }
      },
    }),
    /Selected history verification failed/,
  );
  assert(context);
  assert(existsSync(join(home, "data/nerve.sqlite.migrating")));
  assert(existsSync(join(home, "data/tasks/task_old/stdout.txt")));
  // Restart rebuilds from the retained source, then simulate a crash after verify
  // deleted the source but before the runner could append its ledger.
  await step.run(context);
  await step.verify!(context);
  assert.equal(existsSync(join(home, "data/nerve.sqlite.migrating")), false);
  assert.deepEqual(
    JSON.parse(await readFile(join(home, "manifest.json"), "utf8")).migrations,
    [],
  );
  await runMigrations(home, { registry });
  assert.equal(
    JSON.parse(await readFile(join(home, "manifest.json"), "utf8")).migrations
      .length,
    1,
  );
  assert.deepEqual(await readdir(join(home, "migrations/work")), []);
});

async function addToolResults(
  home: string,
): Promise<{ image: string; source: string }> {
  const image = Buffer.alloc(128 * 1024, 42).toString("base64");
  const source = "conversations/one/tool-calls/file/result.json";
  const result = {
    content: Array.from({ length: 1000 }, (_, i) => `output line ${i}`).join(
      "\n",
    ),
    contentBlocks: [{ type: "image", data: image, mimeType: "image/png" }],
  };
  await mkdir(join(home, "data", "conversations/one/tool-calls/file"), {
    recursive: true,
  });
  await writeFile(join(home, "data", source), JSON.stringify({ result }));
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    for (const [index, id] of ["tool_inline", "tool_file"].entries()) {
      const call = {
        id,
        toolName: "read",
        args: { path: "fixture.png" },
        status: "completed",
        settledAt: timestamp,
        ...(index ? { resultPayload: { logicalPath: source } } : { result }),
      };
      db.prepare(
        "INSERT INTO conversation_records VALUES (?, 'conv_one', 'agent_one', 'tool_call', ?, NULL, NULL, 1, ?)",
      ).run(id, 10 + index, Buffer.from(JSON.stringify({ toolCall: call })));
    }
  } finally {
    db.close();
  }
  return { image, source };
}

void test("0001 externalizes inline/file results and image blocks, builds bounded previews, and retries without changing source files", async (t) => {
  const home = await fixture(t),
    { image, source } = await addToolResults(home);
  const original = await readFile(join(home, "data", source), "utf8");
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: ({ phase }) => {
        if (phase === "preserve-task-outputs")
          throw new Error("crash after result files");
      },
    }),
    /crash after result files/,
  );
  assert.equal(await readFile(join(home, "data", source), "utf8"), original);
  const logs: string[] = [];
  const logged = {
    ...step,
    async verify(ctx: StepContext) {
      await step.verify!({ ...ctx, log: (message) => logs.push(message) });
    },
  };
  await runMigrations(home, { registry: [{ ...registry[0], step: logged }] });
  assert(!existsSync(join(home, "data", source)));
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    const responses = db
      .prepare(
        "SELECT payload FROM conversation_event WHERE event_type='tool_call_response'",
      )
      .all();
    assert.equal(responses.length, 2);
    for (const row of responses) {
      const text = String(row.payload),
        payload = JSON.parse(text);
      assert(!text.includes(image));
      assert(!("result" in payload));
      assert(!("modelContent" in payload));
      assert(Buffer.byteLength(text) < 16000);
      assert.equal(payload.agentProjection[0].type, "image");
      assert.equal(
        payload.userProjection.resultPreview.contentBlocks[0].assetId,
        payload.agentProjection[0].assetId,
      );
      assert(payload.userProjection.previewOverflow.hidden > 0);
      const assets = payload.assetIds.map(
        (id: string) => db.prepare("SELECT * FROM asset WHERE id=?").get(id)!,
      );
      const resultAsset = assets.find(
        (asset: Record<string, unknown>) => asset.category === "payload",
      )!;
      const complete = JSON.parse(
        await readFile(
          join(home, "data", String(resultAsset.logical_path)),
          "utf8",
        ),
      );
      assert(complete.content.includes("output line 999"));
      assert.deepEqual(complete.contentBlocks[0], payload.agentProjection[0]);
      const imageAsset = assets.find(
        (asset: Record<string, unknown>) => asset.category === "image",
      )!;
      assert.equal(imageAsset.id, payload.agentProjection[0].assetId);
      assert.deepEqual(
        await readFile(join(home, "data", String(imageAsset.logical_path))),
        Buffer.from(image, "base64"),
      );
    }
    assert.equal(
      db.prepare("SELECT count(*) n FROM asset WHERE category='image'").get()!
        .n,
      2,
    );
    assert(
      logs.some(
        (line) =>
          line.startsWith("Payload bytes:") &&
          line.includes('"max":') &&
          line.includes('"avg":'),
      ),
    );
    t.diagnostic(logs.find((line) => line.startsWith("Payload bytes:"))!);
  } finally {
    db.close();
  }
});

void test("0001 rejects inline result or base64 image payloads before deleting the legacy source", async (t) => {
  for (const field of ["result", "image"]) {
    const home = await fixture(t);
    await addToolResults(home);
    await assert.rejects(
      runMigrations(home, {
        registry,
        onProgress: ({ phase }) => {
          if (phase !== "verify") return;
          const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
          try {
            const row = db
              .prepare(
                "SELECT id, payload FROM conversation_event WHERE event_type='tool_call_response' LIMIT 1",
              )
              .get()!;
            const payload = JSON.parse(String(row.payload));
            if (field === "result") payload.result = { content: "forbidden" };
            else
              payload.agentProjection.push({
                type: "image",
                mimeType: "image/png",
                data: "Zm9v",
              });
            db.prepare(
              "UPDATE conversation_event SET payload=? WHERE id=?",
            ).run(JSON.stringify(payload), row.id);
          } finally {
            db.close();
          }
        },
      }),
      /Inline complete result|Inline base64 image/,
    );
    assert(existsSync(join(home, "data/nerve.sqlite.migrating")));
    assert(
      existsSync(
        join(home, "data/conversations/one/tool-calls/file/result.json"),
      ),
    );
    await runMigrations(home, { registry });
  }
});
