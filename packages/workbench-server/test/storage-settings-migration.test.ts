import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts";
import {
  initializeStorage,
  writeSettings,
} from "../src/infrastructure/storage/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("settings migrations", () => {
  for (const colorMode of ["system", "light", "dark"] as const) {
    it(`migrates the legacy ${colorMode} appearance setting`, async () => {
      const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
      roots.push(root);
      const configPath = join(root, "config.json");
      await initializeStorage(root);
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
    await initializeStorage(root);
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
    await initializeStorage(root);
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

  it("adds the image explanation tool as disabled to older settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    await initializeStorage(root);
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
    await initializeStorage(root);
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
