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
  it("backfills notification preferences for older settings files", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-migration-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    await initializeStorage(root);
    const legacySettings = { ...defaultSettings, notifications: undefined };
    await writeFile(
      configPath,
      `${JSON.stringify(legacySettings, null, 2)}\n`,
      "utf8",
    );

    const storage = await initializeStorage(root);

    assert.deepEqual(storage.settings.notifications, {
      systemEnabled: true,
      soundsEnabled: true,
    });
  });

  it("merges partial notification preference updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-settings-update-"));
    roots.push(root);
    const storage = await initializeStorage(root);

    await writeSettings(storage, {
      notifications: { systemEnabled: false },
    });
    await writeSettings(storage, {
      notifications: { soundsEnabled: false },
    });

    assert.deepEqual(storage.settings.notifications, {
      systemEnabled: false,
      soundsEnabled: false,
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
