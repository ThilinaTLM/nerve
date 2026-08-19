import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { defaultSettings, taskRecordSchema } from "@nervekit/contracts";
import type {
  MigrationContext,
  StorageMigration,
} from "../src/infrastructure/migrations/migration.js";
import {
  assertCanonicalRelativePath,
  joinCanonicalPath,
} from "../src/infrastructure/migrations/canonical-path.js";
import { migrationChecksum } from "../src/infrastructure/migrations/checksum.js";
import { migration0004 } from "../src/infrastructure/migrations/migrations/0004-dense-event-stream-layout.js";
import { migration0005 } from "../src/infrastructure/migrations/migrations/0005-current-project-sidecars.js";
import { migration0006 } from "../src/infrastructure/migrations/migrations/0006-unify-tool-call-lifecycle.js";
import { migration0007 } from "../src/infrastructure/migrations/migrations/0007-transient-conversation-live-events.js";
import { migration0008 } from "../src/infrastructure/migrations/migrations/0008-remove-legacy-storage.js";
import { migration0009 } from "../src/infrastructure/migrations/migrations/0009-native-task-runtimes.js";
import { migration0010 } from "../src/infrastructure/migrations/migrations/0010-integration-provider-profiles.js";
import { EncryptedFileSecretProvider } from "../src/infrastructure/secrets/index.js";
import { providerApiKeySecretName } from "../src/domains/auth/pi-ai-credential-store.js";
import { StreamLog } from "../src/infrastructure/events/stream-log.js";
import {
  ledgerDigest,
  readLedger,
} from "../src/infrastructure/migrations/ledger.js";
import { createRollbackBundle } from "../src/infrastructure/migrations/rollback-bundle.js";
import { runStorageMigrations } from "../src/infrastructure/migrations/runner.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);
async function home() {
  const value = await mkdtemp(join(tmpdir(), "nerve-migrations-"));
  roots.push(value);
  return value;
}
function migrationContext(root: string): MigrationContext {
  return { paths: { home: root } } as unknown as MigrationContext;
}

function migration(
  id: string,
  behavior: Partial<StorageMigration> = {},
): StorageMigration {
  return {
    id,
    checksum: migrationChecksum(`${id}|test-v1`),
    description: id,
    detect: async () => "current",
    backup: async () => ({ paths: [] }),
    up: async () => undefined,
    verify: async () => undefined,
    ...behavior,
  };
}

describe("storage migration runner", () => {
  it("constructs and validates normalized canonical backup paths", () => {
    assert.equal(
      joinCanonicalPath("conversations", "conv_test", "tool-calls"),
      "conversations/conv_test/tool-calls",
    );
    for (const path of [
      "",
      ".",
      "../state.txt",
      "nested/../state.txt",
      "nested/./state.txt",
      "nested//state.txt",
      "/state.txt",
      "nested\\state.txt",
    ]) {
      assert.throws(() => assertCanonicalRelativePath(path), /unsafe/i);
    }
  });

  it("rejects unsafe rollback scopes at the canonical/native boundary", async () => {
    const root = await home();
    for (const path of [
      "../state.txt",
      "nested/../state.txt",
      "/state.txt",
      "nested\\state.txt",
    ]) {
      await assert.rejects(
        createRollbackBundle({
          home: root,
          migrationsDir: join(root, "migrations"),
          id: "unsafe-path-test",
          ledgerDigest: "digest",
          paths: [path],
        }),
        /unsafe/i,
      );
    }
  });

  it("keeps every dynamically discovered backup path canonical", async () => {
    const root = await home();
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs", "events.jsonl.1"), "");

    const conversation = join(root, "conversations", "conv_test");
    await mkdir(join(conversation, "tool-calls"), { recursive: true });
    await writeFile(join(conversation, "events.jsonl"), "");
    await writeFile(
      join(conversation, "events.meta.json"),
      JSON.stringify({ lastSeq: 0 }),
    );

    const project = join(root, "projects", "proj_test");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "pinned-commands.json"), "[]");

    const context = migrationContext(root);
    const specs = await Promise.all(
      [migration0004, migration0005, migration0006, migration0007].map(
        (entry) => entry.backup(context),
      ),
    );
    const paths = specs.flatMap((spec) => spec.paths);

    assert.ok(paths.includes("logs/events.jsonl.1"));
    assert.ok(paths.includes("projects/proj_test/pinned-commands.json"));
    assert.ok(paths.includes("conversations/conv_test/tool-calls"));
    assert.ok(paths.includes("conversations/conv_test/events.jsonl"));
    assert.ok(paths.every((path) => !path.includes("\\")));
    assert.doesNotThrow(() => paths.forEach(assertCanonicalRelativePath));

    const bundle = await createRollbackBundle({
      home: root,
      migrationsDir: join(root, "migrations"),
      id: "canonical-paths-test",
      ledgerDigest: "digest",
      paths,
    });
    const manifest = JSON.parse(
      await readFile(join(bundle.directory, "manifest.json"), "utf8"),
    ) as { entries: Array<{ path: string }> };
    assert.ok(manifest.entries.every((entry) => !entry.path.includes("\\")));
    assert.doesNotThrow(() =>
      manifest.entries.forEach((entry) =>
        assertCanonicalRelativePath(entry.path),
      ),
    );
  });

  it("archives sparse logs and establishes the dense epoch", async () => {
    const root = await home();
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs", "events.jsonl"), '{"seq":9}\n');
    await writeFile(
      join(root, "logs", "workspace-events.meta.json"),
      '{"lastSeq":9}\n',
    );

    const first = await runStorageMigrations(root, {
      registry: [migration0004],
    });

    assert.equal(first.executions[0]?.execution, "ran");
    await assert.rejects(
      readFile(join(root, "logs", "events.jsonl"), "utf8"),
      /ENOENT/,
    );
    assert.equal(
      await readFile(
        join(
          root,
          "migrations",
          "archives",
          migration0004.id,
          "logs",
          "events.jsonl",
        ),
        "utf8",
      ),
      '{"seq":9}\n',
    );
    assert.ok(await readFile(join(root, "logs", ".dense-streams-v1"), "utf8"));

    const second = await runStorageMigrations(root, {
      registry: [migration0004],
    });
    assert.deepEqual(second.executions, []);
  });

  it("accepts active dense journals after their layout marker exists", async () => {
    const root = await home();
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs", ".dense-streams-v1"), "{}\n");
    await writeFile(join(root, "logs", "workspace-events.jsonl"), "");
    await writeFile(join(root, "logs", "events.jsonl"), "");

    const report = await runStorageMigrations(root, {
      registry: [migration0004],
    });

    assert.equal(report.executions[0]?.execution, "detected");
    assert.equal(
      await readFile(join(root, "logs", "workspace-events.jsonl"), "utf8"),
      "",
    );
  });

  it("archives old conversation streams and installs a snapshot barrier", async () => {
    const root = await home();
    const conversationDir = join(root, "conversations", "conv_test");
    await mkdir(conversationDir, { recursive: true });
    await writeFile(
      join(conversationDir, "events.jsonl"),
      `${JSON.stringify({
        seq: 5,
        id: "evt_5",
        ts: "2026-01-01T00:00:00.000Z",
        type: "conversation.live.content.delta",
        data: {},
      })}\n`,
    );
    await writeFile(
      join(conversationDir, "events.meta.json"),
      `${JSON.stringify({ lastSeq: 5 })}\n`,
    );

    await runStorageMigrations(root, { registry: [migration0007] });

    await assert.rejects(
      readFile(join(conversationDir, "events.jsonl"), "utf8"),
      /ENOENT/,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(conversationDir, "events.meta.json"), "utf8"),
      ),
      { lastSeq: 6 },
    );
    assert.match(
      await readFile(
        join(
          root,
          "migrations",
          "archives",
          migration0007.id,
          "conversations",
          "conv_test",
          "events.jsonl",
        ),
        "utf8",
      ),
      /evt_5/,
    );
    const log = await StreamLog.open({
      stream: "conv/conv_test",
      logPath: join(conversationDir, "events.jsonl"),
      metaPath: join(conversationDir, "events.meta.json"),
    });
    assert.deepEqual(log.bounds(), {
      stream: "conv/conv_test",
      latestSeq: 6,
      earliestAvailableSeq: 7,
    });
    const appended = await log.append("evt_7", "run.completed", {}, false);
    assert.equal(appended.seq, 7);
    await log.close();
  });

  it("removes retired storage without archiving it again", async () => {
    const root = await home();
    for (const relative of [
      "desktop/Cache/value",
      "handovers/old.json",
      "logs/archive/pre-dense/events.jsonl",
      "migrations/archives/0007/events.jsonl",
      "prompt-suggestions/.keep-empty-parent",
    ]) {
      const path = join(root, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "legacy");
    }
    await rm(join(root, "prompt-suggestions", ".keep-empty-parent"));
    await writeFile(join(root, "nerve.sqlite"), "legacy");
    await writeFile(join(root, "state.sqlite"), "current");

    const report = await runStorageMigrations(root, {
      registry: [migration0008],
    });

    assert.equal(report.backupBytes, 0);
    assert.deepEqual(report.archivePaths, []);
    for (const relative of [
      "desktop",
      "handovers",
      "nerve.sqlite",
      "logs/archive",
      "migrations/archives",
      "prompt-suggestions",
    ]) {
      await assert.rejects(lstat(join(root, relative)), /ENOENT/);
    }
    assert.equal(await readFile(join(root, "state.sqlite"), "utf8"), "current");
    const ledger = await readLedger(join(root, "migrations", "ledger.json"));
    assert.equal(ledger.applied.at(-1)?.id, migration0008.id);

    const second = await runStorageMigrations(root, {
      registry: [migration0008],
    });
    assert.deepEqual(second.executions, []);
  });

  it("retires pre-native task runtimes before task hydration", async () => {
    const root = await home();
    const tasks = join(root, "tasks");
    const startedAt = "2026-08-17T01:02:03.000Z";
    const migratedAt = "2026-08-18T04:05:06.000Z";
    const baseRecord = {
      cwd: "C:\\Users\\test\\project",
      command: "pnpm dev",
      readiness: { outcome: "pending" },
      stdoutPath: "stdout.log",
      stderrPath: "stderr.log",
      logsPath: "events.jsonl",
      startedAt,
      updatedAt: startedAt,
    };
    const legacyRuntime = {
      platform: "win32",
      childPid: 4321,
      detached: false,
      shell: true,
      spawnedAt: startedAt,
    };
    const active = {
      ...baseRecord,
      id: "task_legacy_active",
      status: "running",
      runtime: legacyRuntime,
    };
    const terminal = {
      ...baseRecord,
      id: "task_legacy_terminal",
      status: "completed",
      finishedAt: "2026-08-17T02:02:03.000Z",
      runtime: { ...legacyRuntime, identity: { kind: "legacy_unverified" } },
    };
    const native = {
      ...baseRecord,
      id: "task_native",
      status: "running",
      runtime: {
        version: 2,
        platform: "linux",
        childPid: 9876,
        processGroupId: 9876,
        detached: true,
        shell: true,
        containment: "process-group",
        spawnedAt: startedAt,
        identity: { kind: "linux", startTimeTicks: 12345 },
        capabilities: {
          identity: true,
          processTree: true,
          listeningPorts: true,
          detail: "native:process-group",
        },
      },
    };
    for (const record of [active, terminal, native]) {
      const directory = join(tasks, record.id);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "task.json"),
        `${JSON.stringify(record)}\n`,
      );
    }

    const backup = await migration0009.backup(migrationContext(root));
    assert.deepEqual(backup.paths, [
      "tasks/task_legacy_active/task.json",
      "tasks/task_legacy_terminal/task.json",
      "migrations/.native-task-runtimes-v1",
    ]);
    assert.ok(backup.paths.every((path) => !path.includes("\\")));

    const report = await runStorageMigrations(root, {
      registry: [migration0009],
      now: () => new Date(migratedAt),
    });
    assert.equal(report.executions[0]?.execution, "ran");
    assert.ok(report.backupBytes > 0);

    const readTask = async (id: string) =>
      JSON.parse(await readFile(join(tasks, id, "task.json"), "utf8")) as {
        [key: string]: unknown;
      };
    const migratedActive = await readTask(active.id);
    assert.equal(migratedActive.status, "interrupted");
    assert.equal(migratedActive.finishedAt, migratedAt);
    assert.equal(migratedActive.updatedAt, migratedAt);
    assert.match(String(migratedActive.error), /native process management/);
    assert.equal("runtime" in migratedActive, false);
    assert.equal(taskRecordSchema.safeParse(migratedActive).success, true);

    const migratedTerminal = await readTask(terminal.id);
    assert.equal(migratedTerminal.status, "completed");
    assert.equal(migratedTerminal.finishedAt, terminal.finishedAt);
    assert.equal(migratedTerminal.updatedAt, startedAt);
    assert.equal("runtime" in migratedTerminal, false);
    assert.equal(taskRecordSchema.safeParse(migratedTerminal).success, true);

    assert.deepEqual(await readTask(native.id), native);
    assert.equal(taskRecordSchema.safeParse(native).success, true);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(root, "migrations", ".native-task-runtimes-v1"),
          "utf8",
        ),
      ),
      { migratedAt, transformedRecords: 2 },
    );

    const second = await runStorageMigrations(root, {
      registry: [migration0009],
    });
    assert.deepEqual(second.executions, []);
  });

  it("migrates compatible integration credentials into shared profiles and splits conflicts", async () => {
    const sharedRoot = await home();
    const sharedSecrets = new EncryptedFileSecretProvider(sharedRoot);
    await sharedSecrets.set(providerApiKeySecretName("jira"), "shared-token");
    await sharedSecrets.set(
      providerApiKeySecretName("confluence"),
      "shared-token",
    );
    await sharedSecrets.set(providerApiKeySecretName("tavily"), "tavily-key");
    await writeFile(
      join(sharedRoot, "config.json"),
      `${JSON.stringify({
        ...defaultSettings,
        providers: undefined,
        tools: {
          ...defaultSettings.tools,
          web: undefined,
          jira: {
            enabled: true,
            siteUrl: "https://example.atlassian.net",
            email: "User@example.com",
            defaultProjectKey: "PROJ",
          },
          confluence: {
            enabled: true,
            siteUrl: "https://example.atlassian.net/wiki",
            email: "user@example.com",
            defaultSpaceKey: "DOCS",
          },
        },
      })}\n`,
    );

    const report = await runStorageMigrations(sharedRoot, {
      registry: [migration0010],
    });
    assert.equal(report.executions[0]?.execution, "ran");
    const shared = JSON.parse(
      await readFile(join(sharedRoot, "config.json"), "utf8"),
    ) as typeof defaultSettings;
    assert.equal(shared.providers.atlassianProfiles.length, 1);
    assert.equal(shared.tools.jira.profileId, "legacy-atlassian-default");
    assert.equal(shared.tools.confluence.profileId, "legacy-atlassian-default");
    assert.equal(shared.tools.web.tavilyProfileId, "legacy-tavily-default");
    assert.equal(
      await sharedSecrets.get(
        providerApiKeySecretName("atlassian:legacy-atlassian-default"),
      ),
      "shared-token",
    );
    assert.equal(
      await sharedSecrets.get(providerApiKeySecretName("jira")),
      undefined,
    );
    assert.equal(
      await sharedSecrets.get(providerApiKeySecretName("confluence")),
      undefined,
    );
    assert.equal(
      await sharedSecrets.get(providerApiKeySecretName("tavily")),
      undefined,
    );
    assert.deepEqual(
      (await runStorageMigrations(sharedRoot, { registry: [migration0010] }))
        .executions,
      [],
    );

    const splitRoot = await home();
    const splitSecrets = new EncryptedFileSecretProvider(splitRoot);
    await splitSecrets.set(providerApiKeySecretName("jira"), "jira-token");
    await splitSecrets.set(
      providerApiKeySecretName("confluence"),
      "confluence-token",
    );
    await writeFile(
      join(splitRoot, "config.json"),
      `${JSON.stringify({
        ...defaultSettings,
        providers: undefined,
        tools: {
          ...defaultSettings.tools,
          jira: {
            enabled: true,
            siteUrl: "https://jira.atlassian.net",
            email: "jira@example.com",
          },
          confluence: {
            enabled: true,
            siteUrl: "https://docs.atlassian.net",
            email: "docs@example.com",
          },
        },
      })}\n`,
    );
    await runStorageMigrations(splitRoot, { registry: [migration0010] });
    const split = JSON.parse(
      await readFile(join(splitRoot, "config.json"), "utf8"),
    ) as typeof defaultSettings;
    assert.equal(split.providers.atlassianProfiles.length, 2);
    assert.equal(split.tools.jira.profileId, "legacy-atlassian-jira");
    assert.equal(
      split.tools.confluence.profileId,
      "legacy-atlassian-confluence",
    );
    assert.equal(
      await splitSecrets.get(
        providerApiKeySecretName("atlassian:legacy-atlassian-jira"),
      ),
      "jira-token",
    );
    assert.equal(
      await splitSecrets.get(
        providerApiKeySecretName("atlassian:legacy-atlassian-confluence"),
      ),
      "confluence-token",
    );
  });

  it("preserves populated prompt-suggestion state during legacy cleanup", async () => {
    const root = await home();
    const current = join(root, "prompt-suggestions", "enabled.json");
    await mkdir(join(current, ".."), { recursive: true });
    await writeFile(current, '{"version":1,"records":[]}\n');

    await runStorageMigrations(root, { registry: [migration0008] });

    assert.match(await readFile(current, "utf8"), /records/);
  });

  it("baselines current state without a rollback copy and reruns idempotently", async () => {
    const root = await home();
    const registry = [migration("0001-baseline")];
    const first = await runStorageMigrations(root, { registry });
    assert.equal(first.backupBytes, 0);
    assert.equal(first.executions[0]?.execution, "detected");
    const second = await runStorageMigrations(root, { registry });
    assert.equal(second.executions.length, 0);
    if (process.platform !== "win32") {
      assert.equal(
        (await stat(join(root, "migrations", "ledger.json"))).mode & 0o777,
        0o600,
      );
    }
  });

  it("creates one batch bundle, restores on failure, and leaves the ledger unchanged", async () => {
    const root = await home();
    const state = join(root, "state.txt");
    await writeFile(state, "before");
    let verifyCalls = 0;
    const registry = [
      migration("0001-write", {
        detect: async () => "pending",
        backup: async () => ({ paths: ["state.txt"] }),
        up: async () => writeFile(state, "first"),
      }),
      migration("0002-fail", {
        detect: async () => "pending",
        backup: async () => ({ paths: ["state.txt"] }),
        up: async () => writeFile(state, "second"),
        verify: async () => {
          verifyCalls += 1;
          throw new Error("injected verify failure");
        },
      }),
    ];
    await assert.rejects(runStorageMigrations(root, { registry }), /0002-fail/);
    assert.equal(await readFile(state, "utf8"), "before");
    assert.equal(verifyCalls, 1);
    await assert.rejects(
      readFile(join(root, "migrations", "ledger.json"), "utf8"),
      /ENOENT/,
    );
  });

  it("rejects a corrupted ledger and a live migration lock", async () => {
    const root = await home();
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(join(root, "migrations", "ledger.json"), "{bad json");
    await assert.rejects(
      runStorageMigrations(root, { registry: [] }),
      /ledger/i,
    );
    await writeFile(
      join(root, "migrations", "ledger.json"),
      JSON.stringify({ version: 1, applied: [] }),
    );
    await writeFile(
      join(root, "migrations", "lock.json"),
      JSON.stringify({
        pid: process.pid,
        hostname: "test",
        acquiredAt: new Date().toISOString(),
      }),
    );
    await assert.rejects(
      runStorageMigrations(root, { registry: [], lockTimeoutMs: 20 }),
      /lock/i,
    );
  });

  it("takes over a stale lock and recovers an interrupted batch before detection", async () => {
    const root = await home();
    await mkdir(join(root, "migrations"), { recursive: true });
    await writeFile(
      join(root, "migrations", "lock.json"),
      JSON.stringify({
        pid: 999_999_999,
        host: hostname(),
        startedAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const state = join(root, "state.txt");
    await writeFile(state, "before");
    const ledger = await readLedger(join(root, "migrations", "ledger.json"));
    await createRollbackBundle({
      home: root,
      migrationsDir: join(root, "migrations"),
      id: "interrupted-test",
      ledgerDigest: ledgerDigest(ledger),
      paths: ["state.txt"],
    });
    await writeFile(state, "interrupted");
    let observed = "";
    await runStorageMigrations(root, {
      registry: [
        migration("0001-recovered", {
          detect: async () => {
            observed = await readFile(state, "utf8");
            return "current";
          },
        }),
      ],
      lockTimeoutMs: 20,
    });
    assert.equal(observed, "before");
    assert.equal(await readFile(state, "utf8"), "before");
  });

  it("rejects symlinks in rollback scope without touching the target", async () => {
    const root = await home();
    const external = join(await home(), "outside.txt");
    await writeFile(external, "safe");
    await symlink(external, join(root, "linked.txt"));
    const registry = [
      migration("0001-link", {
        detect: async () => "pending",
        backup: async () => ({ paths: ["linked.txt"] }),
      }),
    ];
    await assert.rejects(
      runStorageMigrations(root, { registry }),
      /symbolic link/i,
    );
    assert.equal(await readFile(external, "utf8"), "safe");
    assert.equal(
      (await lstat(join(root, "linked.txt"))).isSymbolicLink(),
      true,
    );
  });
});
