import assert from "node:assert/strict";
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
import { after, it } from "node:test";
import type { MigrationContext } from "../src/infrastructure/migrations/migration.js";
import { migration0012 } from "../src/infrastructure/migrations/migrations/0012-remove-workers.js";
import { runStorageMigrations } from "../src/infrastructure/migrations/runner.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

async function home() {
  const value = await mkdtemp(join(tmpdir(), "nerve-remove-workers-"));
  roots.push(value);
  return value;
}

function migrationContext(root: string): MigrationContext {
  return { paths: { home: root } } as unknown as MigrationContext;
}

it("removes persisted worker state and resets incompatible workspace replay", async () => {
  const root = await home();
  const migratedAt = "2026-08-19T12:34:56.000Z";
  const agentPath = join(root, "agents", "agent_legacy", "agent.json");
  const taskPath = join(root, "tasks", "task_legacy", "task.json");
  await mkdir(join(root, "agents", "agent_legacy"), { recursive: true });
  await mkdir(join(root, "tasks", "task_legacy"), { recursive: true });
  await mkdir(join(root, "workers", "worker_legacy"), { recursive: true });
  await mkdir(join(root, "logs"), { recursive: true });
  await mkdir(join(root, "migrations"), { recursive: true });

  const timestamp = "2026-08-18T01:02:03.000Z";
  await writeFile(
    agentPath,
    `${JSON.stringify({
      id: "agent_legacy",
      conversationId: "conv_legacy",
      projectId: "proj_legacy",
      projectDir: "/tmp/project",
      workerId: "worker_legacy",
      rootAgentId: "agent_legacy",
      mode: "coding",
      permissionLevel: "autonomous",
      workspaceScope: { roots: ["/tmp/project"] },
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
    })}\n`,
  );
  await writeFile(
    taskPath,
    `${JSON.stringify({
      id: "task_legacy",
      workerId: "worker_legacy",
      cwd: "/tmp/project",
      command: "pnpm check",
      status: "completed",
      readiness: { outcome: "none" },
      stdoutPath: "stdout.log",
      stderrPath: "stderr.log",
      logsPath: "logs.jsonl",
      startedAt: timestamp,
      updatedAt: timestamp,
    })}\n`,
  );
  await writeFile(
    join(root, "workers", "worker_legacy", "worker.json"),
    '{"id":"worker_legacy"}\n',
  );
  await writeFile(
    join(root, "logs", "workspace-events.jsonl"),
    [
      JSON.stringify({
        seq: 4,
        id: "evt_before",
        ts: timestamp,
        type: "project.created",
        data: {},
      }),
      JSON.stringify({
        seq: 5,
        id: "evt_worker",
        ts: timestamp,
        type: "worker.created",
        data: { worker: { id: "worker_legacy" } },
      }),
    ].join("\n") + "\n",
  );
  await writeFile(
    join(root, "logs", "workspace-events.meta.json"),
    '{"lastSeq":9}\n',
  );

  const database = new DatabaseSync(join(root, "state.sqlite"));
  database.exec("CREATE TABLE workers (id TEXT PRIMARY KEY)");
  database.close();

  const backup = await migration0012.backup(migrationContext(root));
  assert.deepEqual(backup.paths, [
    "agents/agent_legacy/agent.json",
    "tasks/task_legacy/task.json",
    "workers",
    "logs/workspace-events.jsonl",
    "logs/workspace-events.meta.json",
    "state.sqlite",
    "state.sqlite-wal",
    "state.sqlite-shm",
    "migrations/.workers-removed-v1",
  ]);
  assert.ok(backup.paths.every((path) => !path.includes("\\")));

  const report = await runStorageMigrations(root, {
    registry: [migration0012],
    now: () => new Date(migratedAt),
  });
  assert.equal(report.executions[0]?.execution, "ran");
  assert.ok(report.backupBytes > 0);

  const agent = JSON.parse(await readFile(agentPath, "utf8")) as Record<
    string,
    unknown
  >;
  const task = JSON.parse(await readFile(taskPath, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal("workerId" in agent, false);
  assert.equal("workerId" in task, false);
  await assert.rejects(stat(join(root, "workers")), /ENOENT/);
  assert.equal(
    await readFile(join(root, "logs", "workspace-events.jsonl"), "utf8"),
    "",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(root, "logs", "workspace-events.meta.json"), "utf8"),
    ),
    { lastSeq: 9 },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(root, "migrations", ".workers-removed-v1"), "utf8"),
    ),
    {
      migratedAt,
      scrubbedAgents: 1,
      scrubbedTasks: 1,
      workspaceJournalReset: true,
      workspaceLastSeq: 9,
    },
  );
  const migratedDatabase = new DatabaseSync(join(root, "state.sqlite"));
  const table = migratedDatabase
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workers'",
    )
    .get();
  migratedDatabase.close();
  assert.equal(table, undefined);

  const second = await runStorageMigrations(root, {
    registry: [migration0012],
  });
  assert.deepEqual(second.executions, []);
});
