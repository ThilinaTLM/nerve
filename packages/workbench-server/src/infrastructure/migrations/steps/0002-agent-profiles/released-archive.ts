import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { readText, writeProtected, safePath } from "./files.js";
import { jsonBytes } from "./released-format.js";
const pointerSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    state: z.enum(["active", "committed", "rolled-back"]),
  })
  .strict();
export interface ArchiveIO {
  read(path: string): string | undefined;
  write(path: string, bytes: string): void;
}
const disk: ArchiveIO = {
  read(path) {
    safePath(path);
    return existsSync(path) ? readText(path) : undefined;
  },
  write: writeProtected,
};
const pointerPath = (home: string) =>
  join(home, "quarantine/settings/migration-0002/active.json");
export function currentMigrationArchive(home: string, io: ArchiveIO = disk) {
  const bytes = io.read(pointerPath(home));
  if (bytes === undefined) return undefined;
  const pointer = pointerSchema.parse(JSON.parse(bytes));
  return {
    ...pointer,
    directory: join(home, "quarantine/settings/migration-0002", pointer.id),
  };
}
/** Explicit rollback starts a new attempt next time, without deleting or
 * overwriting the previous attempt's originals, receipts or database snapshot. */
export function beginMigrationArchive(
  home: string,
  io: ArchiveIO = disk,
  id: () => string = randomUUID,
) {
  const current = currentMigrationArchive(home, io);
  if (current && current.state !== "rolled-back") return current.directory;
  const pointer = pointerSchema.parse({
    schemaVersion: 1,
    id: id(),
    state: "active",
  });
  assert(pointer.id !== current?.id, "Archive attempt identity must be unique");
  assert(
    io.read(
      join(home, "quarantine/settings/migration-0002", pointer.id, "plan.json"),
    ) === undefined,
    "Migration archive identity collision",
  );
  io.write(pointerPath(home), jsonBytes(pointer));
  return currentMigrationArchive(home, io)!.directory;
}
export function finishMigrationArchive(
  home: string,
  directory: string,
  state: "committed" | "rolled-back",
  io: ArchiveIO = disk,
): void {
  const current = currentMigrationArchive(home, io);
  assert(current?.directory === directory, "Migration archive pointer changed");
  if (state === "rolled-back")
    assert(
      current.state !== "committed",
      "Verified migration cannot be rolled back automatically",
    );
  io.write(
    pointerPath(home),
    jsonBytes({ schemaVersion: 1, id: current.id, state }),
  );
}
