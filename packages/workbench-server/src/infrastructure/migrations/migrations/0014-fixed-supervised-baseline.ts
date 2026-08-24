import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  agentRecordSchema,
  conversationRecordSchema,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import { joinCanonicalPath } from "../canonical-path.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const markerPath = "migrations/.fixed-supervised-baseline-v1";

type LegacyRecord = {
  kind: "agent" | "conversation";
  relativePath: string;
  value: Record<string, unknown>;
};

async function legacyRecords(home: string): Promise<LegacyRecord[]> {
  const definitions = [
    { kind: "agent" as const, directory: "agents", fileName: "agent.json" },
    {
      kind: "conversation" as const,
      directory: "conversations",
      fileName: "conversation.json",
    },
  ];
  const records: LegacyRecord[] = [];
  for (const definition of definitions) {
    const entries = await readdir(join(home, definition.directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = joinCanonicalPath(
        definition.directory,
        entry.name,
        definition.fileName,
      );
      const value = await readJsonFile<unknown>(join(home, relativePath)).catch(
        () => undefined,
      );
      if (!isRecord(value) || !Object.hasOwn(value, "approvalPolicy")) continue;
      records.push({ kind: definition.kind, relativePath, value });
    }
  }
  return records.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export const migration0014: StorageMigration = {
  id: "0014-fixed-supervised-baseline",
  description: "Make supervised safe reads a fixed permission baseline",
  checksum: migrationChecksum(
    "0014-fixed-supervised-baseline|v1|Make supervised safe reads a fixed permission baseline",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup(context) {
    const records = await legacyRecords(context.paths.home);
    return {
      paths: [...records.map((record) => record.relativePath), markerPath],
    };
  },
  async up(context) {
    const records = await legacyRecords(context.paths.home);
    for (const record of records) {
      const value = { ...record.value };
      delete value.approvalPolicy;
      const parsed =
        record.kind === "agent"
          ? agentRecordSchema.parse(value)
          : conversationRecordSchema.parse(value);
      await atomicWriteJson(
        join(context.paths.home, record.relativePath),
        parsed,
        0o600,
      );
    }
    await atomicWriteJson(
      join(context.paths.home, markerPath),
      {
        migratedAt: context.now().toISOString(),
        rewrittenRecords: records.length,
      },
      0o600,
    );
  },
  async verify(context) {
    if (!(await pathExists(join(context.paths.home, markerPath)))) {
      throw new Error("Fixed supervised baseline marker is missing.");
    }
    const records = await legacyRecords(context.paths.home);
    if (records.length) {
      throw new Error(
        `Deprecated approval policy remains at '${records[0]?.relativePath}'.`,
      );
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
