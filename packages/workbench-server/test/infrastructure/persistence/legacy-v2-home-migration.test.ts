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
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import {
  inspectLegacyV2Home,
  migrateLegacyV2Home,
} from "../../../src/infrastructure/migrations/index.js";
import { EncryptedFileSecretProvider } from "../../../src/infrastructure/secrets/index.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const now = "2026-08-26T00:00:00.000Z";

async function createPost0012Home(home: string): Promise<void> {
  await cp(
    fileURLToPath(
      new URL("../../fixtures/storage/post-0012/", import.meta.url),
    ),
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
  await createPost0012Home(home);
  assert.deepEqual(await inspectLegacyV2Home(home), { kind: "legacy-v2" });

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
  t.after(async () => {
    await storage.canonicalStore.close();
    await rm(root, { recursive: true, force: true });
  });
  const schema = new DatabaseSync(storage.paths.sqlitePath, { readOnly: true });
  const schemaMigrations = schema
    .prepare(`SELECT version, name FROM schema_migrations ORDER BY version`)
    .all()
    .map((row) => ({
      version: Number((row as { version: unknown }).version),
      name: String((row as { name: unknown }).name),
    }));
  schema.close();
  assert.deepEqual(schemaMigrations, [{ version: 1, name: "nerve-home-v1" }]);
  const homeMigrations = JSON.parse(
    await readFile(storage.paths.migrationLedgerPath, "utf8"),
  ) as { entries: Array<{ id: string }> };
  assert.deepEqual(
    homeMigrations.entries.map((entry) => entry.id),
    [
      "nerve-home-v1",
      "tool-result-payload-reference-v2",
      "legacy-v2-to-nerve-home-v1",
    ],
  );
  assert.equal(storage.settings.defaultThinkingLevel, "high");
  assert.equal(
    storage.configuration.providers.providers[0]?.id,
    "migration-provider",
  );
  // Permission exceptions were never externally shipped and are not imported
  // into the versioned rule-set/overlay format.
  assert.deepEqual(storage.configuration.permissions.rules, []);
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

test("rejects canonical development homes without the exact v0.26 ledger", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-development-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(home, "VERSION"),
    `${JSON.stringify({ format: "nerve-workbench-state", version: 2 })}
`,
  );
  const database = new DatabaseSync(join(home, "state.sqlite"));
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL
    );
    INSERT INTO schema_migrations VALUES (3, '${"0".repeat(64)}');
  `);
  database.close();

  assert.equal((await inspectLegacyV2Home(home)).kind, "not-legacy-v2");
  await assert.rejects(migrateLegacyV2Home(home), /released Nerve 0\.26/);
  assert.equal((await stat(join(home, "state.sqlite"))).isFile(), true);
});

test("refuses a legacy home while its daemon is running", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-running-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await cp(
    fileURLToPath(
      new URL("../../fixtures/storage/post-0012/", import.meta.url),
    ),
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
      fileURLToPath(
        new URL("../../fixtures/storage/post-0012/", import.meta.url),
      ),
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
