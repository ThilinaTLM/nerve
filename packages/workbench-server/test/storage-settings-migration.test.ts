import assert from "node:assert/strict";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import {
  type DaemonStartupProgress,
  defaultSettings,
} from "@nervekit/contracts";
import { MIGRATION_0002_INDEX_SCHEMA_SQL } from "../src/infrastructure/migrations/migrations/0002-index-schema.js";
import {
  initializeStorage,
  readCurrentSettingsForBootstrap,
  writeSettings,
} from "../src/infrastructure/storage/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("settings migrations", () => {
  it("does not create prompt-suggestion state before first use", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-lazy-suggestions-"));
    roots.push(root);

    await initializeStorage(root);

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
    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );
  });

  it("upgrades a fully migrated pre-supervision home before desktop bootstrap", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "nerve-settings-pre-supervision-"),
    );
    roots.push(root);
    const fixture = new URL("./fixtures/storage/pre-0013/", import.meta.url);
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
      /pending migration.*supervision/i,
    );
    const storage = await initializeStorage(root);
    assert.deepEqual(storage.settings.supervision, { grants: [] });
    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );

    const rerunLedger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      applied: Array<{ id: string }>;
    };
    assert.equal(rerunLedger.applied.at(-1)?.id, "0013-supervision-settings");
    const second = await initializeStorage(root);
    assert.deepEqual(second.settings, storage.settings);
  });

  it("uses only canonical settings for a current home", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-bootstrap-"));
    roots.push(root);
    const storage = await initializeStorage(root);

    assert.deepEqual(
      await readCurrentSettingsForBootstrap(root),
      storage.settings,
    );

    await writeFile(join(root, "config.json"), "not-json\n");
    await assert.rejects(
      readCurrentSettingsForBootstrap(root),
      /settings.*unreadable/i,
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

  it("moves legacy server settings into application configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    try {
      const legacy = {
        ...defaultSettings,
        application: undefined,
        server: { host: "127.0.0.1", port: 4100, allowRemote: true },
      };
      await writeFile(join(root, "config.json"), `${JSON.stringify(legacy)}\n`);
      const progress: DaemonStartupProgress[] = [];
      const storage = await initializeStorage(root, {
        reportStartupProgress: (event) => progress.push(event),
      });
      assert.equal(progress[0]?.phase, "storage-check");
      assert.equal(
        progress.some((event) => event.phase === "storage-migration"),
        true,
      );
      assert.deepEqual(storage.settings.application.network, {
        host: "0.0.0.0",
        port: 4100,
        allowRemote: true,
        mobileHttps: false,
        httpsPort: 3748,
      });
      const persisted = JSON.parse(
        await readFile(join(root, "config.json"), "utf8"),
      ) as Record<string, unknown>;
      assert.equal("server" in persisted, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const colorMode of ["system", "light", "dark"] as const) {
    it(`migrates the legacy ${colorMode} appearance setting`, async () => {
      const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
      roots.push(root);
      const configPath = join(root, "config.json");
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            ...defaultSettings,
            ui: { theme: colorMode, zoomLevel: 3, onboardingVersion: 4 },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const storage = await initializeStorage(root);

      assert.deepEqual(storage.settings.ui, {
        theme: "nerve",
        colorMode,
        zoomLevel: 3,
      });
      const persisted = JSON.parse(await readFile(configPath, "utf8")) as {
        ui: {
          theme: string;
          colorMode: string;
          zoomLevel: number;
        };
      };
      assert.deepEqual(persisted.ui, storage.settings.ui);
    });
  }

  it("backfills notification preferences for older settings files", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    const legacySettings = {
      ...defaultSettings,
      notifications: { systemEnabled: true, soundsEnabled: true },
    };
    await writeFile(
      configPath,
      `${JSON.stringify(legacySettings, null, 2)}\n`,
      "utf8",
    );

    const storage = await initializeStorage(root);

    assert.deepEqual(storage.settings.notifications, {
      systemEnabled: true,
      soundsEnabled: true,
      events: {
        question: "bell",
        planReview: "chime",
        approval: "bell",
        completed: "success",
        failed: "alert",
      },
    });
  });

  it("replaces removed notification tones with event defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...defaultSettings,
          notifications: {
            ...defaultSettings.notifications,
            events: {
              ...defaultSettings.notifications.events,
              question: "ping",
              completed: "kenney-switch-20",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const storage = await initializeStorage(root);

    assert.equal(storage.settings.notifications.events.question, "ping");
    assert.equal(storage.settings.notifications.events.completed, "success");
    const persisted = JSON.parse(await readFile(configPath, "utf8")) as {
      notifications: { events: { question: string; completed: string } };
    };
    assert.equal(persisted.notifications.events.question, "ping");
    assert.equal(persisted.notifications.events.completed, "success");
  });

  it("merges partial notification preference updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-update-"));
    roots.push(root);
    const storage = await initializeStorage(root);

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

  it("adds the image explanation tool as disabled to older settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    const legacyTools: Partial<typeof defaultSettings.tools> = {
      ...defaultSettings.tools,
    };
    delete legacyTools.imageExplanation;
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...defaultSettings,
          tools: { ...legacyTools, disabled: ["web_search"] },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const storage = await initializeStorage(root);

    assert.deepEqual(storage.settings.tools.disabled, [
      "web_search",
      "explain_image",
    ]);
    assert.deepEqual(storage.settings.tools.imageExplanation, {
      thinkingLevel: "off",
    });
  });

  it("migrates and deduplicates the legacy python disabled tool name", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...defaultSettings,
          logging: { ...defaultSettings.logging, level: "debug" },
          tools: {
            ...defaultSettings.tools,
            disabled: ["web_search", "python", "python_exec"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const storage = await initializeStorage(root);

    assert.deepEqual(storage.settings.tools.disabled, [
      "web_search",
      "python_exec",
    ]);
    assert.equal(storage.settings.logging.level, "debug");
    const persisted = JSON.parse(await readFile(configPath, "utf8")) as {
      tools: { disabled: string[] };
      logging: { level: string };
    };
    assert.deepEqual(persisted.tools.disabled, ["web_search", "python_exec"]);
    assert.equal(persisted.logging.level, "debug");
  });
});
