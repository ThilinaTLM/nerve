import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  agentRecordSchema,
  eventEnvelopeSchema,
  taskRecordSchema,
} from "@nervekit/contracts";
import { atomicWriteFile } from "../../storage/file-mutations.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
  readJsonLines,
} from "../../storage/json.js";
import { joinCanonicalPath } from "../canonical-path.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";
import { tableNames } from "../sqlite.js";

const markerPath = "migrations/.workers-removed-v1";
const workerEventTypes = new Set(["worker.created", "worker.agent_started"]);

type RecordKind = "agent" | "task";

type LegacyRecordFile = {
  kind: RecordKind;
  relativePath: string;
  value: Record<string, unknown>;
};

type WorkspaceJournalState = {
  containsWorkerEvents: boolean;
  lastSeq: number;
};

async function legacyRecordFiles(home: string): Promise<LegacyRecordFile[]> {
  const files = await Promise.all([
    filesWithWorkerId(home, "agent", "agents", "agent.json"),
    filesWithWorkerId(home, "task", "tasks", "task.json"),
  ]);
  return files
    .flat()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function filesWithWorkerId(
  home: string,
  kind: RecordKind,
  directory: string,
  fileName: string,
): Promise<LegacyRecordFile[]> {
  const entries = await readdir(join(home, directory), {
    withFileTypes: true,
  }).catch(() => []);
  const files: LegacyRecordFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relativePath = joinCanonicalPath(directory, entry.name, fileName);
    const value = await readJsonFile<unknown>(join(home, relativePath)).catch(
      () => undefined,
    );
    if (!isRecord(value) || !Object.hasOwn(value, "workerId")) continue;
    files.push({ kind, relativePath, value });
  }
  return files;
}

async function workspaceJournalState(
  home: string,
): Promise<WorkspaceJournalState> {
  const logPath = join(home, "logs", "workspace-events.jsonl");
  const values = await readJsonLines<unknown>(logPath).catch(() => []);
  let containsWorkerEvents = false;
  let lastSeq = 0;
  for (const value of values) {
    const event = eventEnvelopeSchema.safeParse(value);
    if (!event.success) continue;
    lastSeq = Math.max(lastSeq, event.data.seq);
    if (workerEventTypes.has(event.data.type)) containsWorkerEvents = true;
  }
  const metadata = await readJsonFile<unknown>(
    join(home, "logs", "workspace-events.meta.json"),
  ).catch(() => undefined);
  if (
    isRecord(metadata) &&
    typeof metadata.lastSeq === "number" &&
    Number.isSafeInteger(metadata.lastSeq)
  ) {
    lastSeq = Math.max(lastSeq, metadata.lastSeq);
  }
  return { containsWorkerEvents, lastSeq };
}

async function rewriteRecord(home: string, file: LegacyRecordFile) {
  const value = { ...file.value };
  delete value.workerId;
  const parsed =
    file.kind === "agent"
      ? agentRecordSchema.parse(value)
      : taskRecordSchema.parse(value);
  await atomicWriteJson(join(home, file.relativePath), parsed, 0o600);
}

async function resetWorkspaceJournal(home: string, lastSeq: number) {
  const logs = join(home, "logs");
  await atomicWriteFile(join(logs, "workspace-events.jsonl"), "", {
    mode: 0o600,
  });
  await atomicWriteJson(
    join(logs, "workspace-events.meta.json"),
    { lastSeq },
    0o600,
  );
}

async function workersTableExists(
  context: Parameters<StorageMigration["detect"]>[0],
): Promise<boolean> {
  if (!(await pathExists(context.paths.sqlitePath))) return false;
  return context.withDatabase((database) =>
    tableNames(database).has("workers"),
  );
}

export const migration0012: StorageMigration = {
  id: "0012-remove-workers",
  description: "Remove the retired worker execution abstraction",
  checksum: migrationChecksum(
    "0012-remove-workers|v1|Remove the retired worker execution abstraction",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup(context) {
    const home = context.paths.home;
    const records = await legacyRecordFiles(home);
    const journal = await workspaceJournalState(home);
    return {
      paths: [
        ...records.map((file) => file.relativePath),
        ...((await pathExists(join(home, "workers"))) ? ["workers"] : []),
        ...(journal.containsWorkerEvents
          ? ["logs/workspace-events.jsonl", "logs/workspace-events.meta.json"]
          : []),
        "state.sqlite",
        "state.sqlite-wal",
        "state.sqlite-shm",
        markerPath,
      ],
    };
  },
  async up(context) {
    const home = context.paths.home;
    const records = await legacyRecordFiles(home);
    let agents = 0;
    let tasks = 0;
    for (const file of records) {
      await rewriteRecord(home, file);
      if (file.kind === "agent") agents += 1;
      else tasks += 1;
    }

    context.transaction((database) =>
      database.exec("DROP TABLE IF EXISTS workers"),
    );
    await rm(join(home, "workers"), { recursive: true, force: true });

    const journal = await workspaceJournalState(home);
    if (journal.containsWorkerEvents) {
      await resetWorkspaceJournal(home, journal.lastSeq);
    }

    await atomicWriteJson(
      join(home, markerPath),
      {
        migratedAt: context.now().toISOString(),
        scrubbedAgents: agents,
        scrubbedTasks: tasks,
        workspaceJournalReset: journal.containsWorkerEvents,
        workspaceLastSeq: journal.lastSeq,
      },
      0o600,
    );
  },
  async verify(context) {
    const home = context.paths.home;
    if (!(await pathExists(join(home, markerPath)))) {
      throw new Error("Worker cleanup marker is missing.");
    }
    if (await pathExists(join(home, "workers"))) {
      throw new Error("Retired worker storage remains.");
    }
    if (await workersTableExists(context)) {
      throw new Error("Retired workers index table remains.");
    }
    const records = await legacyRecordFiles(home);
    if (records.length > 0) {
      throw new Error(
        `Retired worker identity remains at '${records[0]?.relativePath}'.`,
      );
    }
    if ((await workspaceJournalState(home)).containsWorkerEvents) {
      throw new Error("Retired worker events remain in the workspace journal.");
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
