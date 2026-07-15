import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { EncryptedFileSecretProvider } from "../src/infrastructure/secrets/index.js";
import {
  LegacyHomeMigrationError,
  migrateLegacyWorkbenchHome,
} from "../src/infrastructure/storage/legacy-home-migration.js";
import { inspectWorkbenchHome } from "../src/infrastructure/storage/state-layout.js";

const roots: string[] = [];
const fixedNow = () => new Date("2026-07-16T01:32:29.000Z");

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempLegacyHome(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "nerve-legacy-migration-"));
  roots.push(root);
  const home = join(root, ".nerve");
  await mkdir(home);
  await writeFile(join(home, "config.json"), '{"legacy":true}\n');
  return { root, home };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("legacy workbench home migration", () => {
  it("retains the full legacy tree and re-encrypts only provider/tool credentials", async () => {
    const { home } = await tempLegacyHome();
    await mkdir(join(home, "projects", "project_old"), { recursive: true });
    await writeFile(
      join(home, "projects", "project_old", "sentinel.txt"),
      "legacy project\n",
    );
    await writeFile(join(home, "providers.json"), '{"legacy":true}\n');

    const sourceSecrets = new EncryptedFileSecretProvider(home);
    const credentials = new Map([
      ["provider:openai:apiKey", "sk-test-openai"],
      [
        "provider:openai-codex:oauth",
        JSON.stringify({
          type: "oauth",
          access: "access-test",
          refresh: "refresh-test",
          expires: 4_102_444_800_000,
        }),
      ],
      ["provider:tavily:apiKey", "tvly-test"],
      ["provider:jira:apiKey", "jira-test"],
      ["provider:confluence:apiKey", "confluence-test"],
    ]);
    for (const [name, value] of credentials) {
      await sourceSecrets.set(name, value);
    }
    await sourceSecrets.set(
      "task:task_legacy:launchConfig",
      '{"secret":"must-not-migrate"}',
    );
    const oldMasterKey = await readFile(
      join(home, "keys", "master.key"),
      "utf8",
    );

    const result = await migrateLegacyWorkbenchHome(home, { now: fixedNow });

    assert.equal(result.backupPath, `${home}-bk-20260716-013229`);
    assert.equal(result.credentialStatus, "imported");
    assert.equal(result.importedCredentialCount, credentials.size);
    assert.equal(
      await readFile(
        join(result.backupPath, "projects", "project_old", "sentinel.txt"),
        "utf8",
      ),
      "legacy project\n",
    );
    assert.equal(
      await readFile(join(result.backupPath, "config.json"), "utf8"),
      '{"legacy":true}\n',
    );
    assert.equal(
      await inspectWorkbenchHome(home).then((item) => item.kind),
      "current",
    );
    assert.equal(await exists(join(home, "projects", "project_old")), false);
    assert.equal(await exists(join(home, "providers.json")), false);

    const targetSecrets = new EncryptedFileSecretProvider(home);
    for (const [name, value] of credentials) {
      assert.equal(await targetSecrets.get(name), value);
    }
    assert.equal(
      await targetSecrets.get("task:task_legacy:launchConfig"),
      undefined,
    );
    assert.notEqual(
      await readFile(join(home, "keys", "master.key"), "utf8"),
      oldMasterKey,
    );
  });

  it("never overwrites an existing timestamped backup", async () => {
    const { home } = await tempLegacyHome();
    const existing = `${home}-bk-20260716-013229`;
    await mkdir(existing);
    await writeFile(join(existing, "sentinel.txt"), "keep me\n");

    const result = await migrateLegacyWorkbenchHome(home, { now: fixedNow });

    assert.equal(result.backupPath, `${existing}-2`);
    assert.equal(
      await readFile(join(existing, "sentinel.txt"), "utf8"),
      "keep me\n",
    );
  });

  it("starts fresh when the legacy home has no credential store", async () => {
    const { home } = await tempLegacyHome();

    const result = await migrateLegacyWorkbenchHome(home, { now: fixedNow });

    assert.equal(result.credentialStatus, "none");
    assert.equal(result.importedCredentialCount, 0);
    assert.equal(
      await inspectWorkbenchHome(home).then((item) => item.kind),
      "current",
    );
    assert.equal(await exists(join(result.backupPath, "config.json")), true);
  });

  it("keeps the backup and continues when legacy credentials cannot be decrypted", async () => {
    const { home } = await tempLegacyHome();
    await mkdir(join(home, "keys"));
    await writeFile(join(home, "keys", "master.key"), "not-a-valid-key\n");
    await writeFile(join(home, "keys", "secrets.json.enc"), "not-json\n");

    const result = await migrateLegacyWorkbenchHome(home, { now: fixedNow });

    assert.equal(result.credentialStatus, "failed");
    assert.equal(result.importedCredentialCount, 0);
    assert.equal(
      await readFile(
        join(result.backupPath, "keys", "secrets.json.enc"),
        "utf8",
      ),
      "not-json\n",
    );
    assert.equal(
      await inspectWorkbenchHome(home).then((item) => item.kind),
      "current",
    );
  });

  it("refuses to rename a legacy home whose daemon PID is alive", async () => {
    const { home } = await tempLegacyHome();
    await writeFile(
      join(home, "daemon.json"),
      `${JSON.stringify({
        daemonId: "daemon_legacy",
        pid: process.pid,
        host: "127.0.0.1",
        port: 3747,
        url: "http://127.0.0.1:3747",
        startedAt: new Date().toISOString(),
        dataDir: home,
        version: "0.7.0",
      })}\n`,
    );

    await assert.rejects(
      migrateLegacyWorkbenchHome(home, { now: fixedNow }),
      (error: unknown) =>
        error instanceof LegacyHomeMigrationError &&
        error.code === "LEGACY_DAEMON_RUNNING" &&
        error.details.originalRestored,
    );
    assert.equal(await exists(join(home, "config.json")), true);
    assert.equal(await exists(`${home}-bk-20260716-013229`), false);
  });

  it("rolls back the original home after a fresh-home initialization failure", async () => {
    const { home } = await tempLegacyHome();

    await assert.rejects(
      migrateLegacyWorkbenchHome(home, {
        now: fixedNow,
        initializeFreshHome: async (target) => {
          await mkdir(target);
          await writeFile(join(target, "partial.txt"), "partial\n");
          throw new Error("injected initialization failure");
        },
      }),
      (error: unknown) =>
        error instanceof LegacyHomeMigrationError &&
        error.code === "MIGRATION_FAILED" &&
        error.details.originalRestored,
    );
    assert.equal(
      await readFile(join(home, "config.json"), "utf8"),
      '{"legacy":true}\n',
    );
    assert.equal(await exists(join(home, "partial.txt")), false);
    assert.equal(await exists(`${home}-bk-20260716-013229`), false);
  });

  it("rolls back after a target credential write failure", async () => {
    const { home } = await tempLegacyHome();
    await new EncryptedFileSecretProvider(home).set(
      "provider:openai:apiKey",
      "sk-test",
    );

    await assert.rejects(
      migrateLegacyWorkbenchHome(home, {
        now: fixedNow,
        writeCredential: async () => {
          throw new Error("injected credential write failure");
        },
      }),
      (error: unknown) =>
        error instanceof LegacyHomeMigrationError &&
        error.code === "MIGRATION_FAILED" &&
        error.details.originalRestored,
    );
    assert.equal(
      await new EncryptedFileSecretProvider(home).get("provider:openai:apiKey"),
      "sk-test",
    );
    assert.equal(await exists(`${home}-bk-20260716-013229`), false);
  });
});
