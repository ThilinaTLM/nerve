import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  coordinateStorageStartup,
  StorageStartupError,
} from "../src/infrastructure/storage/startup-coordinator.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function legacyHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-startup-coordinator-"));
  roots.push(root);
  const home = join(root, ".nerve");
  await mkdir(home);
  await writeFile(
    join(home, "config.json"),
    '{"defaultThinkingLevel":"high"}\n',
  );
  return home;
}

describe("storage startup coordinator", () => {
  it("does not mutate a legacy home when consent is denied", async () => {
    const home = await legacyHome();
    await assert.rejects(
      coordinateStorageStartup(home, {
        requestLegacyConsent: () => false,
      }),
      (error: unknown) =>
        error instanceof StorageStartupError && error.code === "CONSENT_DENIED",
    );
    assert.equal(
      await readFile(join(home, "config.json"), "utf8"),
      '{"defaultThinkingLevel":"high"}\n',
    );
  });

  it("fails closed for malformed legacy daemon metadata", async () => {
    const home = await legacyHome();
    await writeFile(join(home, "daemon.json"), "not-json\n");
    await assert.rejects(
      coordinateStorageStartup(home),
      (error: unknown) =>
        error instanceof StorageStartupError &&
        error.code === "INVALID_DAEMON_METADATA" &&
        error.details.originalRestored,
    );
    assert.equal(
      await readFile(join(home, "daemon.json"), "utf8"),
      "not-json\n",
    );
  });

  it("refuses a malformed adjacent recovery journal without touching the home", async () => {
    const home = await legacyHome();
    await writeFile(`${home}.startup-journal.json`, '{"phase":"renamed"}\n');
    await assert.rejects(
      coordinateStorageStartup(home),
      (error: unknown) =>
        error instanceof StorageStartupError &&
        error.code === "UNSUPPORTED_STATE",
    );
    assert.equal(
      await readFile(join(home, "config.json"), "utf8"),
      '{"defaultThinkingLevel":"high"}\n',
    );
  });
});
