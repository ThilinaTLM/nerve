import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { defaultSettings } from "@nervekit/contracts";
import { ConversationJournalRepository } from "../src/domains/conversations/conversation-journal.repository.js";
import { CanonicalStore } from "../src/infrastructure/canonical-store/index.js";
import {
  inspectLegacyV2Home,
  migrateLegacyV2Home,
} from "../src/infrastructure/home-migration/index.js";
import { EncryptedFileSecretProvider } from "../src/infrastructure/secrets/index.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const now = "2026-08-26T00:00:00.000Z";

async function createCanonicalV3Home(home: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(
    join(home, "VERSION"),
    `${JSON.stringify({ format: "nerve-workbench-state", version: 2 }, null, 2)}\n`,
  );
  const sqlitePath = join(home, "state.sqlite");
  const store = new CanonicalStore(sqlitePath);
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home, sqlitePath },
    canonicalStore: store,
  });
  await journal.commit("conv_migration_test", {
    kind: "migration.fixture",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_migration_test",
        conversation: {
          id: "conv_migration_test",
          projectId: "proj_migration_test",
          title: "Migrated conversation",
          mode: "coding",
          permissionLevel: "supervised",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        kind: "conversation.entry_appended",
        conversationId: "conv_migration_test",
        entry: {
          id: "entry_migration_test",
          conversationId: "conv_migration_test",
          role: "user",
          kind: "message",
          text: "Preserve this message",
          createdAt: now,
        },
      },
    ],
  });
  await store.writeDocument({
    namespace: "project",
    scopeId: "global",
    documentId: "proj_migration_test",
    data: {
      id: "proj_migration_test",
      name: "Migration project",
      path: "/tmp/migration-project",
      createdAt: now,
      updatedAt: now,
    },
    expectedRevision: 0,
    now,
  });
  await store.writeDocument({
    namespace: "provider_catalog",
    scopeId: "global",
    documentId: "catalog",
    data: {
      version: 1,
      providers: [
        {
          id: "migration-provider",
          displayName: "Migration Provider",
          api: "openai-completions",
          baseUrl: "https://example.test/v1",
          headers: { "X-Test": "value" },
        },
      ],
      models: [],
    },
    expectedRevision: 0,
    now,
  });
  await store.close();

  const database = new DatabaseSync(sqlitePath);
  database.exec(`
    CREATE TABLE settings_store (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      payload_version INTEGER NOT NULL,
      data BLOB NOT NULL,
      updated_at_ms INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE permission_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('user','project')),
      project_id TEXT,
      effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
      tool_name TEXT NOT NULL,
      matcher_kind TEXT NOT NULL CHECK(matcher_kind IN ('whole_tool','path_glob','command_glob','url_glob')),
      pattern TEXT NOT NULL,
      source_digest TEXT CHECK(source_digest IS NULL OR length(source_digest) = 64),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      CHECK((scope = 'project' AND project_id IS NOT NULL) OR (scope = 'user' AND project_id IS NULL))
    ) STRICT;
    CREATE INDEX permission_rules_scope_tool
      ON permission_rules(scope, project_id, tool_name, enabled);
    DELETE FROM schema_migrations;
  `);
  database
    .prepare(
      `INSERT INTO schema_migrations
       (version, name, checksum, applied_at_ms, duration_ms)
       VALUES (3, 'normalize-canonical-data', ?, ?, 0)`,
    )
    .run(
      "0c37fcedf26320bcbc4b7b966a39ccbaa9759fd8295fc3cdc8c850d0c8598367",
      Date.parse(now),
    );
  database
    .prepare(
      `INSERT INTO settings_store
       (id, revision, payload_version, data, updated_at_ms)
       VALUES ('settings', 1, 1, ?, ?)`,
    )
    .run(
      Buffer.from(
        JSON.stringify({ ...defaultSettings, defaultThinkingLevel: "high" }),
      ),
      Date.parse(now),
    );
  database.close();

  await writeLegacySecrets(home, {
    "provider:migration-provider:apiKey": "migration-secret-value",
    "task:task_legacy:launchConfig": "must-not-import",
  });
  await mkdir(
    join(
      home,
      "payloads",
      "conversations",
      "conv_migration_test",
      "tool-calls",
    ),
    { recursive: true },
  );
  await writeFile(
    join(
      home,
      "payloads",
      "conversations",
      "conv_migration_test",
      "tool-calls",
      "tool_migration_test.json",
    ),
    '{"large":"result"}\n',
  );
  await mkdir(join(home, "plans"), { recursive: true });
  await writeFile(join(home, "plans", "migration.md"), "# Migrated plan\n");
  for (const directory of ["logs", "cache", "tmp", "crashes"]) {
    await mkdir(join(home, directory), { recursive: true });
    await writeFile(join(home, directory, "sentinel"), directory);
  }
}

async function createPost0012Home(home: string): Promise<void> {
  await cp(
    fileURLToPath(new URL("./fixtures/storage/post-0012/", import.meta.url)),
    home,
    { recursive: true },
  );
  const settings = JSON.parse(
    await readFile(join(home, "config.json"), "utf8"),
  ) as Record<string, unknown>;
  settings.defaultThinkingLevel = "high";
  settings.permissions = {
    version: 1,
    scope: "always_global",
    exceptions: [
      {
        id: "legacy-secrets-deny",
        effect: "deny",
        selector: {
          kind: "path_glob",
          access: "read",
          pattern: "secrets/**",
        },
      },
    ],
  };
  await writeFile(join(home, "config.json"), `${JSON.stringify(settings)}\n`);
  await writeFile(
    join(home, "providers.json"),
    `${JSON.stringify({
      version: 1,
      providers: [
        {
          id: "migration-provider",
          displayName: "Migration Provider",
          api: "openai-completions",
          baseUrl: "https://example.test/v1",
          headers: { "X-Test": "value" },
        },
      ],
      models: [],
    })}\n`,
  );
  await mkdir(join(home, "projects", "proj_migration_test"), {
    recursive: true,
  });
  await writeFile(
    join(home, "projects", "proj_migration_test", "project.json"),
    `${JSON.stringify({
      id: "proj_migration_test",
      name: "Migration project",
      path: "/tmp/migration-project",
      createdAt: now,
      updatedAt: now,
    })}\n`,
  );
  await mkdir(join(home, "agents", "agent_migration_test"), {
    recursive: true,
  });
  await writeFile(
    join(home, "agents", "agent_migration_test", "agent.json"),
    `${JSON.stringify({
      id: "agent_migration_test",
      conversationId: "conv_migration_test",
      projectId: "proj_migration_test",
      projectDir: "/tmp/migration-project",
      rootAgentId: "agent_migration_test",
      mode: "coding",
      permissionLevel: "supervised",
      approvalPolicy: { autoApproveReadOnly: true },
      workspaceScope: { roots: ["/tmp/migration-project"] },
      status: "idle",
      createdAt: now,
      updatedAt: now,
    })}\n`,
  );
  const conversationDirectory = join(
    home,
    "conversations",
    "conv_migration_test",
  );
  await mkdir(join(conversationDirectory, "tool-calls"), { recursive: true });
  await writeFile(
    join(conversationDirectory, "conversation.json"),
    `${JSON.stringify({
      id: "conv_migration_test",
      projectId: "proj_migration_test",
      title: "Migrated conversation",
      mode: "coding",
      permissionLevel: "supervised",
      approvalPolicy: { autoApproveReadOnly: true },
      createdAt: now,
      updatedAt: now,
    })}\n`,
  );
  await writeFile(
    join(conversationDirectory, "entries.jsonl"),
    `${JSON.stringify({
      id: "entry_migration_test",
      conversationId: "conv_migration_test",
      role: "user",
      kind: "message",
      text: "Preserve this message",
      createdAt: now,
    })}\n`,
  );
  await writeFile(join(conversationDirectory, "harness.jsonl"), "");
  await writeFile(
    join(conversationDirectory, "tool-calls", "tool_migration_test.json"),
    `${JSON.stringify({
      id: "tool_migration_test",
      agentId: "agent_migration_test",
      conversationId: "conv_migration_test",
      projectId: "proj_migration_test",
      toolName: "read",
      risk: "read",
      args: { path: "/tmp/migration-project/large.txt" },
      cwd: "/tmp/migration-project",
      status: "completed",
      revision: 1,
      attempt: 1,
      interactions: [],
      settledAt: now,
      result: { content: "x".repeat(100_000) },
      createdAt: now,
      updatedAt: now,
    })}\n`,
  );
  await writeLegacySecrets(home, {
    "provider:migration-provider:apiKey": "migration-secret-value",
    "task:task_legacy:launchConfig": "must-not-import",
  });
  await mkdir(join(home, "plans"), { recursive: true });
  await writeFile(join(home, "plans", "migration.md"), "# Migrated plan\n");
  for (const directory of ["logs", "cache", "tmp", "crashes"]) {
    await mkdir(join(home, directory), { recursive: true });
    await writeFile(join(home, directory, "sentinel"), directory);
  }
}

async function writeLegacySecrets(
  home: string,
  values: Record<string, string>,
): Promise<void> {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(values), "utf8"),
    cipher.final(),
  ]);
  await mkdir(join(home, "keys"), { recursive: true, mode: 0o700 });
  await writeFile(join(home, "keys", "master.key"), key.toString("base64"));
  await writeFile(
    join(home, "keys", "secrets.json.enc"),
    JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    }),
  );
}

test("migrates legacy v2 configuration, conversations, credentials, payloads, and plans", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-legacy-v2-"));
  const home = join(root, ".nerve");
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPost0012Home(home);
  assert.deepEqual(await inspectLegacyV2Home(home), {
    kind: "legacy-v2",
    layout: "released-post-0012",
  });

  const report = await migrateLegacyV2Home(home, {
    now: (() => {
      let offset = 0;
      return () => new Date(Date.parse(now) + offset++ * 1000);
    })(),
  });
  assert.equal(report.counts.conversations, 1);
  assert.ok(report.counts.conversationRecords >= 2);
  assert.equal(report.counts.projects, 1);
  assert.equal(report.counts.agents, 1);
  assert.equal(report.counts.credentials, 1);
  assert.equal(report.counts.payloads, 1);
  assert.equal(report.counts.plans, 1);
  assert.equal((await inspectLegacyV2Home(home)).kind, "not-legacy-v2");
  assert.equal((await stat(report.backupPath)).isDirectory(), true);
  assert.match(
    await readFile(join(report.backupPath, "VERSION"), "utf8"),
    /nerve-workbench-state/,
  );
  assert.match(
    await readFile(
      join(report.backupPath, "migrations", "ledger.json"),
      "utf8",
    ),
    /0012-remove-workers/,
  );
  await assert.rejects(
    readFile(join(report.backupPath, "migrations", ".canonical-storage-v1")),
  );
  assert.equal(
    await readFile(join(report.backupPath, "logs", "sentinel"), "utf8"),
    "logs",
  );

  const storage = await initializeStorage(home);
  t.after(() => storage.canonicalStore.close());
  assert.equal(storage.settings.defaultThinkingLevel, "high");
  assert.equal(
    storage.configuration.providers.providers[0]?.id,
    "migration-provider",
  );
  assert.equal(
    storage.configuration.permissions.rules.some(
      (rule) =>
        rule.effect === "deny" &&
        rule.tool === "read" &&
        rule.matcher.pattern === "secrets/**",
    ),
    true,
  );
  const migratedAgent = await storage.canonicalStore.readDocument<
    Record<string, unknown>
  >("agent", "global", "agent_migration_test");
  assert.equal(migratedAgent?.data.approvalPolicy, undefined);
  const secrets = new EncryptedFileSecretProvider(home);
  assert.equal(
    await secrets.get("provider:migration-provider:apiKey"),
    "migration-secret-value",
  );
  assert.equal(await secrets.get("task:task_legacy:launchConfig"), undefined);
  assert.equal(
    (
      await new ConversationJournalRepository(storage).load(
        "conv_migration_test",
      )
    ).entries[0]?.text,
    "Preserve this message",
  );
  assert.equal(
    await readFile(join(storage.paths.plansPath, "migration.md"), "utf8"),
    "# Migrated plan\n",
  );
  for (const directory of ["logs", "cache", "tmp", "crashes"]) {
    await assert.rejects(readFile(join(home, directory, "sentinel")));
  }
  assert.equal(
    (await readFile(storage.paths.credentialsPath, "utf8")).includes(
      "migration-secret-value",
    ),
    false,
  );
});

test("retains canonical-v3 compatibility", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-legacy-canonical-v3-"));
  const home = join(root, ".nerve");
  t.after(() => rm(root, { recursive: true, force: true }));
  await createCanonicalV3Home(home);
  assert.deepEqual(await inspectLegacyV2Home(home), {
    kind: "legacy-v2",
    layout: "canonical-v3",
  });
  const report = await migrateLegacyV2Home(home);
  assert.equal(report.counts.conversations, 1);
  assert.equal(report.counts.projects, 1);
});

test("refuses a legacy home while its daemon is running", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-running-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await cp(
    fileURLToPath(new URL("./fixtures/storage/post-0012/", import.meta.url)),
    home,
    { recursive: true },
  );
  await writeFile(
    join(home, "daemon.json"),
    JSON.stringify({ pid: process.pid }),
  );
  await assert.rejects(migrateLegacyV2Home(home), /still running/);
  assert.match(
    await readFile(join(home, "VERSION"), "utf8"),
    /nerve-workbench-state/,
  );
  await assert.rejects(stat(`${home}.migration.json`));
});

test("rejects modified and incomplete post-0012 ledgers", async (t) => {
  for (const mutation of ["checksum", "incomplete"] as const) {
    const home = await mkdtemp(join(tmpdir(), `nerve-legacy-${mutation}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    await cp(
      fileURLToPath(new URL("./fixtures/storage/post-0012/", import.meta.url)),
      home,
      { recursive: true },
    );
    const ledgerPath = join(home, "migrations", "ledger.json");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      applied: Array<{ checksum: string }>;
    };
    if (mutation === "checksum") ledger.applied[11]!.checksum = "0".repeat(64);
    else ledger.applied.pop();
    await writeFile(ledgerPath, `${JSON.stringify(ledger)}\n`);
    const before = await readFile(ledgerPath, "utf8");
    const inspection = await inspectLegacyV2Home(home);
    assert.equal(inspection.kind, "not-legacy-v2");
    await assert.rejects(migrateLegacyV2Home(home), /through migration 0012/);
    assert.equal(await readFile(ledgerPath, "utf8"), before);
  }
});

test("rejects unknown homes without changing them", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-unknown-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "VERSION"), '{"format":"other","version":2}\n');
  const before = await readFile(join(home, "VERSION"), "utf8");
  await assert.rejects(migrateLegacyV2Home(home), /Only nerve-workbench-state/);
  assert.equal(await readFile(join(home, "VERSION"), "utf8"), before);
});
