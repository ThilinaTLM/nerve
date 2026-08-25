import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { taskRecordSchema, taskRuntimeSchema } from "@nervekit/contracts";
import { z } from "zod";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import { joinCanonicalPath } from "../canonical-path.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const markerPath = "migrations/.native-task-runtimes-v1";
const interruptionError =
  "Task supervision was interrupted while upgrading to native process management.";

const legacyRuntimeIdentitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("linux"),
    startTimeTicks: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("darwin"), startFingerprint: z.string().min(1) }),
  z.object({ kind: z.literal("win32"), creationDate: z.string().min(1) }),
  z.object({ kind: z.literal("legacy_unverified") }),
]);

const legacyTaskRuntimeSchema = z.object({
  version: z.literal(2).optional(),
  platform: z.string().min(1),
  childPid: z.number().int().positive().optional(),
  processGroupId: z.number().int().positive().optional(),
  detached: z.boolean(),
  shell: z.boolean(),
  containment: z.enum(["job-object", "process-group", "fallback"]).optional(),
  spawnedAt: z.string().datetime(),
  identity: legacyRuntimeIdentitySchema.optional(),
  listeningPorts: z
    .array(
      z.object({
        protocol: z.enum(["tcp", "tcp6"]),
        address: z.string().min(1),
        port: z.number().int().positive().max(65_535),
        pid: z.number().int().positive().optional(),
        processGroupId: z.number().int().positive().optional(),
        processStartTimeTicks: z.number().int().nonnegative().optional(),
        detectedAt: z.string().datetime(),
      }),
    )
    .optional(),
  capabilities: z
    .object({
      identity: z.boolean(),
      processTree: z.boolean(),
      listeningPorts: z.boolean(),
      detail: z.string().optional(),
    })
    .optional(),
});

const legacyTaskRecordSchema = taskRecordSchema.extend({
  runtime: legacyTaskRuntimeSchema.optional(),
});

const terminalStatuses = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
]);

type LegacyTaskRecord = z.infer<typeof legacyTaskRecordSchema>;

type LegacyTaskFile = {
  relativePath: string;
  record: LegacyTaskRecord;
};

async function legacyTaskFiles(home: string): Promise<LegacyTaskFile[]> {
  const root = join(home, "tasks");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: LegacyTaskFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("task_")) continue;
    const relativePath = joinCanonicalPath("tasks", entry.name, "task.json");
    const raw = await readJsonFile<unknown>(join(home, relativePath)).catch(
      () => undefined,
    );
    const parsed = legacyTaskRecordSchema.safeParse(raw);
    if (
      !parsed.success ||
      !parsed.data.runtime ||
      taskRuntimeSchema.safeParse(parsed.data.runtime).success
    ) {
      continue;
    }
    files.push({ relativePath, record: parsed.data });
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function migrateRecord(record: LegacyTaskRecord, migratedAt: string) {
  const withoutRuntime = { ...record };
  delete withoutRuntime.runtime;
  const migrated = terminalStatuses.has(record.status)
    ? withoutRuntime
    : {
        ...withoutRuntime,
        status: "interrupted" as const,
        error: interruptionError,
        finishedAt: migratedAt,
        updatedAt: migratedAt,
      };
  return taskRecordSchema.parse(migrated);
}

export const migration0009: StorageMigration = {
  id: "0009-native-task-runtimes",
  description: "Retire pre-native persisted task runtimes",
  checksum: migrationChecksum(
    "0009-native-task-runtimes|v1|Retire pre-native persisted task runtimes",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup(context) {
    const files = await legacyTaskFiles(context.paths.home);
    return {
      paths: [...files.map((file) => file.relativePath), markerPath],
    };
  },
  async up(context) {
    const files = await legacyTaskFiles(context.paths.home);
    const migratedAt = context.now().toISOString();
    for (const file of files) {
      await atomicWriteJson(
        join(context.paths.home, file.relativePath),
        migrateRecord(file.record, migratedAt),
        0o600,
      );
    }
    await atomicWriteJson(
      join(context.paths.home, markerPath),
      { migratedAt, transformedRecords: files.length },
      0o600,
    );
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath)))) {
      throw new Error("Native task runtime migration marker is missing.");
    }
    const remaining = await legacyTaskFiles(context.paths.home);
    if (remaining.length > 0) {
      throw new Error(
        `Pre-native task runtime remains at '${remaining[0]?.relativePath}'.`,
      );
    }
  },
};
