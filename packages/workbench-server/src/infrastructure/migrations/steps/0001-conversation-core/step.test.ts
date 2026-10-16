import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runMigrations } from "../../framework/runner.js";
import type { StepContext } from "../../framework/step.js";
import step from "./step.js";
import { coreSchemaV1 } from "./schema.js";

import { fixture, registry, timestamp } from "./step-fixture.js";

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
    assert.equal(childCaps.tools.explore, undefined);
    assert.equal(childCaps.toolSettings.explore, undefined);
    assert.equal(
      await readFile(
        join(
          home,
          "data/conversations",
          String(child.id),
          "reports/01-task-agent_child.md",
        ),
        "utf8",
      ),
      "# Explore report\n",
    );
    assert.deepEqual(
      await readdir(
        join(home, "data/conversations", String(child.id), "reports"),
      ),
      ["01-task-agent_child.md"],
    );
    assert.equal(existsSync(join(home, "data/reports")), false);
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
  assert.equal("exploreAgent" in harness, false);
  assert.equal("asyncSubagent" in harness, false);
  assert.deepEqual(harness.tools.disabled, [
    "web_fetch",
    "subagent_prompt",
    "subagent_status",
    "subagent_stop",
  ]);
  const profiles = JSON.parse(
    await readFile(join(home, "config/subagents.json"), "utf8"),
  );
  assert.equal(profiles.schemaVersion, 1);
  assert.equal(profiles.profiles.explore.enabled, false);
  assert.equal(profiles.profiles.explore.model, "fixture/explorer");
  assert.equal(profiles.profiles.explore.thinking, "high");
  assert.equal(profiles.profiles.developer.model, "lead");
  assert.deepEqual(profiles.profiles.developer.compaction, {
    profile: "custom",
    triggerPercent: 75,
    keepRecentPercent: 20,
  });
  assert.equal(existsSync(join(home, "agent/subagents/explore.md")), false);
  const projectProfiles = JSON.parse(
    await readFile(join(home, "project/.nerve/config/subagents.json"), "utf8"),
  );
  assert.equal(
    projectProfiles.profiles.reviewer.instructions,
    "Review this fixture only.",
  );
  assert.equal(
    existsSync(join(home, "project/.nerve/subagents/reviewer.md")),
    false,
  );
  assert.deepEqual(harness.defaults, { permissionRuleSetId: "autonomous" });
  assert.deepEqual(harness.lastSelection, { permissionRuleSetId: "custom" });
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
        join(home, "project/.nerve/launches/definitions.json"),
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
      context = ctx;
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
    /1 conversation could not be upgraded/,
  );
  assert(context);
  assert(existsSync(join(home, "data/nerve.sqlite.migrating")));
  assert(existsSync(join(home, "data/tasks/task_old/stdout.txt")));
  // Simulate the runner's commit boundary and a crash before ledger append.
  await step.run(context);
  await step.verify!(context);
  assert(existsSync(join(home, "data/nerve.sqlite.migrating")));
  await writeFile(join(context.scratchDir, "verified.json"), "{}");
  await step.commit!(context);
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
      /1 conversation could not be upgraded/,
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

void test("0001 pairs process calls, settles pending calls, preserves generic results and verifies asset digests after retry", async (t) => {
  const home = await fixture(t);
  const cases = [
    ["tool_old", "task_start", { command: "echo fixture" }, "bash"],
    ["post", "task_start", { command: "echo post" }, "bash"],
    ["old-logs", "task_logs", { task: "task_old" }, "async_bash"],
    ["status", "task_status", {}, "async_bash"],
    ["logs", "task_logs", { taskId: "task_old" }, "async_bash"],
    ["stop", "task_control", { id: "task_old", action: "stop" }, "async_bash"],
    [
      "restart",
      "task_control",
      { id: "task_old", action: "restart" },
      "task_control",
    ],
    ["named", "task_start", { name: "server" }, "task_start"],
    ["cursor", "task_logs", { id: "task_old", cursor: "opaque" }, "task_logs"],
    ["pending", "task_status", {}, "async_bash"],
    ["shell", "bash", { command: "echo old", timeout: 30 }, "bash"],
    ["durable", "task_start", { command: "old durable" }, "task_start"],
  ] as const;
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    const message = {
      role: "assistant",
      content: cases.map(([id, name, args]) => ({
        type: "toolCall",
        id: `provider_${id}`,
        name,
        arguments: args,
      })),
      api: "fixture",
      provider: "fixture",
      model: "model",
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 0,
    };
    db.prepare(
      "INSERT INTO conversation_records VALUES ('assistant_process', 'conv_one', 'agent_one', 'message', 3, 'entry_one', NULL, 1, ?)",
    ).run(
      Buffer.from(
        JSON.stringify({
          entry: {
            id: "assistant_process",
            kind: "message",
            createdAt: timestamp,
          },
          modelContext: {
            entry: { type: "message", parentId: "entry_one", message },
          },
        }),
      ),
    );
    db.prepare(
      "UPDATE agent_context_leaves SET active_record_id='assistant_process' WHERE conversation_id='conv_one' AND agent_id='agent_conversation'",
    ).run();
    for (const [index, [id, toolName, args]] of cases.entries()) {
      const toolCall = {
        id,
        providerToolCallId: `provider_${id}`,
        toolName,
        args,
        status: id === "pending" ? "waiting" : "completed",
        result:
          id === "pending"
            ? undefined
            : {
                content: `captured ${id}`,
                ...(id === "post"
                  ? { asyncBash: { id: "bash_history", command: "echo post" } }
                  : {}),
              },
        createdAt: timestamp,
      };
      db.prepare(
        "INSERT INTO conversation_records VALUES (?, 'conv_one', 'agent_one', 'tool_call', ?, NULL, NULL, 1, ?)",
      ).run(id, 10 + index, Buffer.from(JSON.stringify({ toolCall })));
    }
  } finally {
    db.close();
  }
  await mkdir(join(home, "data/launches/task_fixture"), { recursive: true });
  await writeFile(
    join(home, "data/launches/task_fixture/log.txt"),
    "launch log",
  );
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: ({ phase }) => {
        if (phase === "preserve-task-outputs") throw new Error("process crash");
      },
    }),
    /process crash/,
  );
  await runMigrations(home, { registry });
  assert.equal(
    await readFile(join(home, "data/launches/launch_fixture/log.txt"), "utf8"),
    "launch log",
  );
  const migrated = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    const responses = migrated
      .prepare(
        "SELECT payload FROM conversation_event WHERE event_type='tool_call_response'",
      )
      .all()
      .map((row) => JSON.parse(String(row.payload)));
    for (const [id, , args, expected] of cases) {
      const response = responses.find(
        (payload) => payload.providerCallId === `provider_${id}`,
      )!;
      assert.equal(response.toolName, expected);
      const assistant = JSON.parse(
        String(
          migrated
            .prepare("SELECT payload FROM conversation_event WHERE id=?")
            .get(response.assistantEventId)!.payload,
        ),
      );
      const block = assistant.content[response.contentIndex];
      assert.equal(block.name, response.toolName);
      assert.deepEqual(block.arguments, response.arguments);
      if (id === "tool_old")
        assert.deepEqual(response.arguments, {
          command: "echo fixture",
          background: true,
        });
      if (id === "status" || id === "pending")
        assert.deepEqual(response.arguments, { action: "list" });
      if (id === "shell")
        assert.deepEqual(response.arguments, { command: "echo old" });
      if (id === "logs" || id === "stop") {
        assert.match(response.arguments.id, /^bash_/);
        assert(!("offset" in response.arguments));
      }
      if (id === "pending") assert.equal(response.outcome, "cancelled");
      const asset = response.assetIds
        .map(
          (assetId: string) =>
            migrated.prepare("SELECT * FROM asset WHERE id=?").get(assetId)!,
        )
        .find((item: Record<string, unknown>) => item.category === "payload")!;
      const bytes = await readFile(
        join(home, "data", String(asset.logical_path)),
      );
      assert.equal(bytes.length, asset.byte_length);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        asset.digest,
      );
      const complete = JSON.parse(bytes.toString());
      if (expected.startsWith("task_")) {
        assert.equal(complete.content, `captured ${id}`);
        assert.deepEqual(complete.details.historicalTool.arguments, args);
      }
    }
    assert.equal(
      migrated.prepare("SELECT count(*) n FROM tool_call").get()!.n,
      0,
    );
  } finally {
    migrated.close();
  }
  assert.deepEqual(
    (await runMigrations(home, { registry, dryRun: true })).pending,
    [],
  );
});

void test("process permissions constrain actions, convert ambiguous grants to ask and are idempotent", async () => {
  const { convertPermissionRules } = await import("./process-history.js");
  const document = {
    rules: [
      { id: "status", decision: "allow", when: { toolNames: ["task_status"] } },
      { id: "logs", decision: "allow", when: { toolNames: ["task_logs"] } },
      {
        id: "group",
        decision: "allow",
        when: { toolGroups: ["taskManagement"] },
      },
      {
        id: "control",
        decision: "allow",
        when: { toolNames: ["task_control"] },
      },
      {
        id: "deny",
        decision: "deny",
        when: { toolGroups: ["taskManagement"] },
      },
      {
        id: "stop",
        decision: "allow",
        when: {
          toolNames: ["task_control"],
          arguments: [
            { path: "args.action", operator: "equals", value: "stop" },
          ],
        },
      },
    ],
  };
  const diagnostics: string[] = [];
  assert(
    convertPermissionRules(document, (message) => diagnostics.push(message)),
  );
  assert.equal(document.rules.length, 6);
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(document.rules[0].when, {
    toolNames: ["async_bash"],
    arguments: [{ path: "args.action", operator: "equals", value: "list" }],
  });
  assert.deepEqual(document.rules[1].when, {
    toolNames: ["async_bash"],
    arguments: [{ path: "args.action", operator: "equals", value: "logs" }],
  });
  assert.deepEqual(document.rules[2].when, { toolGroups: ["process"] });
  assert.equal(document.rules[2].decision, "prompt");
  assert.deepEqual(document.rules[3].when, { toolNames: ["async_bash"] });
  assert.equal(document.rules[3].decision, "prompt");
  assert(diagnostics.every((message) => message.includes("converted to ask")));
  assert.equal(convertPermissionRules(document), false);
});

void test("0001 converts user/project/conversation overlays and custom rule-set files", async (t) => {
  const home = await fixture(t);
  const rule = {
    id: "legacy-status",
    enabled: true,
    priority: 1,
    enforcement: "overridable",
    when: { toolNames: ["task_status"] },
    decision: "allow",
  };
  const overlay = {
    schemaVersion: 2,
    overlays: [{ ruleSetId: "supervised", rules: [rule] }],
  };
  const files = [
    "config/permissions.json",
    "project/.nerve/config/permissions.json",
    "data/conversations/one/permissions.json",
  ];
  for (const file of files) {
    await mkdir(join(home, file, ".."), { recursive: true });
    await writeFile(join(home, file), JSON.stringify(overlay));
  }
  await mkdir(join(home, "config/rule-sets"), { recursive: true });
  await writeFile(
    join(home, "config/rule-sets/custom.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "custom",
      name: "Custom",
      source: "user",
      enabled: true,
      rules: [rule],
    }),
  );
  await runMigrations(home, { registry });
  for (const file of [
    ...files.slice(0, 2),
    "data/conversations/conv_one/config/permissions.json",
  ]) {
    const document = JSON.parse(await readFile(join(home, file), "utf8"));
    assert.deepEqual(document.overlays[0].rules[0].when, {
      toolNames: ["async_bash"],
      arguments: [{ path: "args.action", operator: "equals", value: "list" }],
    });
  }
  const custom = JSON.parse(
    await readFile(join(home, "config/rule-sets/custom.json"), "utf8"),
  );
  assert.equal(custom.rules[0].when.toolNames[0], "async_bash");
});

void test("0001 converts an unsafe-only custom rule set to ask without emptying it", async (t) => {
  const home = await fixture(t);
  await mkdir(join(home, "config/rule-sets"), { recursive: true });
  const path = join(home, "config/rule-sets/unsafe.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      id: "unsafe",
      name: "Unsafe legacy grants",
      source: "user",
      enabled: true,
      rules: [
        {
          id: "old-group",
          enabled: true,
          priority: 1,
          enforcement: "overridable",
          decision: "allow",
          when: { toolGroups: ["taskManagement"] },
        },
      ],
    }),
  );
  await runMigrations(home, { registry });
  const converted = JSON.parse(await readFile(path, "utf8"));
  assert.equal(converted.rules.length, 1);
  assert.equal(converted.rules[0].decision, "prompt");
  assert.deepEqual(converted.rules[0].when, { toolGroups: ["process"] });
  assert(!existsSync(join(home, "data/nerve.sqlite.migrating")));
  const before = await readFile(path, "utf8");
  await runMigrations(home, { registry });
  assert.equal(await readFile(path, "utf8"), before);
});

void test("unsafe action-specific grants become action-specific ask rules", async () => {
  const { convertPermissionRules } = await import("./process-history.js");
  const document = {
    rules: [
      {
        id: "filtered-logs",
        decision: "allow",
        when: {
          toolNames: ["task_logs"],
          arguments: [
            { path: "args.mode", operator: "equals", value: "errors" },
          ],
        },
      },
      {
        id: "filtered-stop",
        decision: "allow",
        when: {
          toolNames: ["task_control"],
          arguments: [
            { path: "args.action", operator: "equals", value: "stop" },
            { path: "args.task", operator: "equals", value: "server" },
          ],
        },
      },
    ],
  };
  const diagnostics: string[] = [];
  assert(
    convertPermissionRules(document, (message) => diagnostics.push(message)),
  );
  for (const [index, action] of ["logs", "stop"].entries()) {
    assert.equal(document.rules[index].decision, "prompt");
    assert.deepEqual(document.rules[index].when, {
      toolNames: ["async_bash"],
      arguments: [{ path: "args.action", operator: "equals", value: action }],
    });
  }
  assert.equal(diagnostics.length, 2);
});
