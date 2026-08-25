import assert from "node:assert/strict";
import {
  copyFile,
  lstat,
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
import { afterEach, describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts";
import { MIGRATION_0002_INDEX_SCHEMA_SQL } from "../src/infrastructure/migrations/released/0002-index-schema-snapshot.js";
import {
  initializeStorage,
  readCurrentSettingsForBootstrap,
  writeSettings,
} from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
const stores: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("settings migrations", () => {
  it("does not create prompt-suggestion state before first use", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-lazy-suggestions-"));
    roots.push(root);

    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);

    await assert.rejects(lstat(join(root, "prompt-suggestions")), /ENOENT/);
    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      defaultSettings,
    );
  });

  it("does not consume unversioned settings during bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-bootstrap-"));
    roots.push(root);
    await writeFile(
      join(root, "config.json"),
      `${JSON.stringify({
        ...defaultSettings,
        application: undefined,
        server: { host: "0.0.0.0", port: 4999, allowRemote: true },
      })}\n`,
    );

    await assert.rejects(
      readCurrentSettingsForBootstrap(root),
      /storage is prepared/,
    );

    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);
    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );
  });

  it("upgrades a released post-0012 home before desktop bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-post-0012-"));
    roots.push(root);
    const fixture = new URL("./fixtures/storage/post-0012/", import.meta.url);
    await mkdir(join(root, "migrations"), { recursive: true });
    await Promise.all([
      copyFile(new URL("VERSION", fixture), join(root, "VERSION")),
      copyFile(new URL("config.json", fixture), join(root, "config.json")),
      copyFile(
        new URL("migrations/ledger.json", fixture),
        join(root, "migrations", "ledger.json"),
      ),
      writeFile(join(root, "local-auth-token"), "fixture-token\n"),
    ]);
    const database = new DatabaseSync(join(root, "state.sqlite"));
    database.exec(MIGRATION_0002_INDEX_SCHEMA_SQL);
    database.close();

    const ledgerPath = join(root, "migrations", "ledger.json");

    await assert.rejects(
      readCurrentSettingsForBootstrap(root),
      /settings.*unreadable/i,
    );
    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);
    assert.deepEqual(storage.settings.permissions, { exceptions: [] });
    assert.equal(
      JSON.stringify(storage.settings).includes("approvalPolicy"),
      false,
    );
    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );

    const rerunLedger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      applied: Array<{ id: string }>;
    };
    assert.equal(rerunLedger.applied.at(-1)?.id, "0013-canonical-storage");
    const canonical = new DatabaseSync(join(root, "state.sqlite"));
    const tables = new Set(
      (
        canonical
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name),
    );
    canonical.close();
    assert.equal(tables.has("schema_migrations"), true);
    for (const retired of [
      "index_meta",
      "projects",
      "conversations",
      "agents",
      "tasks",
      "workers",
      "tool_calls",
      "prompt_suggestion_trust",
    ]) {
      assert.equal(tables.has(retired), false, `retired table ${retired}`);
    }
    assert.deepEqual(
      (await readdir(join(root, "migrations")))
        .filter((name) => name.startsWith("."))
        .sort(),
      [".canonical-storage-v1"],
    );
    const second = await initializeStorage(root);
    stores.push(second.canonicalStore);
    assert.deepEqual(second.settings, storage.settings);
  });

  it("uses only canonical settings for a current home", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-bootstrap-"));
    roots.push(root);
    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);

    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );

    await writeFile(join(root, "config.json"), "not-json\n");
    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );
  });

  it("fails closed for malformed and unsupported VERSION markers", async () => {
    for (const marker of ["not-json\n", '{"format":"other","version":1}\n']) {
      const root = await mkdtemp(join(tmpdir(), "nerve-settings-bootstrap-"));
      roots.push(root);
      await writeFile(join(root, "VERSION"), marker);
      await writeFile(
        join(root, "config.json"),
        `${JSON.stringify(defaultSettings)}\n`,
      );
      await assert.rejects(
        readCurrentSettingsForBootstrap(root),
        /storage is prepared/,
      );
    }
  });

  it("normalizes a representative legacy settings document into canonical SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const legacy = {
      ...defaultSettings,
      application: undefined,
      server: { host: "127.0.0.1", port: 4100, allowRemote: true },
      ui: { theme: "dark", zoomLevel: 3, onboardingVersion: 4 },
      notifications: {
        systemEnabled: true,
        soundsEnabled: true,
        events: { question: "ping", completed: "kenney-switch-20" },
      },
      transcription: undefined,
      tools: {
        ...defaultSettings.tools,
        disabled: ["python", "python", "explain_image"],
        imageExplanation: undefined,
      },
    };
    await writeFile(join(root, "config.json"), `${JSON.stringify(legacy)}\n`);
    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);
    assert.deepEqual(storage.settings.application.network, {
      host: "0.0.0.0",
      port: 4100,
      allowRemote: true,
      mobileHttps: false,
      httpsPort: 3748,
    });
    assert.deepEqual(storage.settings.ui, {
      theme: "nerve",
      colorMode: "dark",
      zoomLevel: 3,
    });
    assert.equal(storage.settings.notifications.events.question, "ping");
    assert.equal(storage.settings.notifications.events.completed, "success");
    assert.deepEqual(
      storage.settings.transcription,
      defaultSettings.transcription,
    );
    assert.deepEqual(storage.settings.tools.disabled, [
      "python_exec",
      "explain_image",
    ]);
    await assert.rejects(readFile(join(root, "config.json")));
  });

  it("merges partial notification preference updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-update-"));
    roots.push(root);
    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);

    await writeSettings(storage, {
      notifications: {
        systemEnabled: false,
        events: { question: "pop" },
      },
    });
    await writeSettings(storage, {
      notifications: {
        soundsEnabled: false,
        events: { completed: "none" },
      },
    });

    assert.deepEqual(storage.settings.notifications, {
      systemEnabled: false,
      soundsEnabled: false,
      events: {
        question: "pop",
        planReview: "chime",
        approval: "bell",
        completed: "none",
        failed: "alert",
      },
    });
  });

  it("backfills and merges transcription preferences", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-update-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    const legacySettings = { ...defaultSettings } as Record<string, unknown>;
    delete legacySettings.transcription;
    await writeFile(
      configPath,
      `${JSON.stringify(legacySettings, null, 2)}\n`,
      "utf8",
    );

    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);
    assert.deepEqual(storage.settings.transcription, {
      model: "gpt-4o-transcribe",
      languages: [],
      vocabulary: [],
    });

    await writeSettings(storage, {
      transcription: { model: "gpt-transcribe", languages: ["en", "fr"] },
    });
    await writeSettings(storage, {
      transcription: { vocabulary: ["Nerve", "Codex CLI"] },
    });

    assert.deepEqual(storage.settings.transcription, {
      model: "gpt-transcribe",
      languages: ["en", "fr"],
      vocabulary: ["Nerve", "Codex CLI"],
    });
  });
});
