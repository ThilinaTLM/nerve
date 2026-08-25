import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function createLegacyV2Home(home: string): Promise<void> {
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
  await createLegacyV2Home(home);

  const report = await migrateLegacyV2Home(home, {
    now: (() => {
      let offset = 0;
      return () => new Date(Date.parse(now) + offset++ * 1000);
    })(),
  });
  assert.equal(report.counts.conversations, 1);
  assert.equal(report.counts.conversationRecords, 1);
  assert.equal(report.counts.projects, 1);
  assert.equal(report.counts.credentials, 1);
  assert.equal(report.counts.payloads, 1);
  assert.equal(report.counts.plans, 1);
  assert.equal((await inspectLegacyV2Home(home)).kind, "not-legacy-v2");
  assert.equal((await stat(report.backupPath)).isDirectory(), true);
  assert.match(
    await readFile(join(report.backupPath, "VERSION"), "utf8"),
    /nerve-workbench-state/,
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

test("refuses a legacy home while its daemon is running", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-running-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(home, "VERSION"),
    `${JSON.stringify({ format: "nerve-workbench-state", version: 2 })}\n`,
  );
  await writeFile(join(home, "daemon.json"), JSON.stringify({ pid: process.pid }));
  await assert.rejects(migrateLegacyV2Home(home), /still running/);
  assert.match(await readFile(join(home, "VERSION"), "utf8"), /nerve-workbench-state/);
  await assert.rejects(stat(`${home}.migration.json`));
});

test("rejects unknown homes without changing them", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-legacy-unknown-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "VERSION"), '{"format":"other","version":2}\n');
  const before = await readFile(join(home, "VERSION"), "utf8");
  await assert.rejects(migrateLegacyV2Home(home), /Only nerve-workbench-state/);
  assert.equal(await readFile(join(home, "VERSION"), "utf8"), before);
});
