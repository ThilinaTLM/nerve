import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createId,
  pinnedCommandSchema,
  SCRATCH_NOTE_DEFAULT_TITLE,
  scratchNoteSchema,
  taskDefinitionSchema,
} from "@nervekit/contracts";
import { z } from "zod";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import type { StorageMigration } from "../migration.js";
import { joinCanonicalPath } from "../canonical-path.js";
import { migrationChecksum } from "../checksum.js";

const legacyScratchNoteSchema = z.object({
  content: z.string(),
  updatedAt: z.string().datetime(),
});

async function projectIds(home: string): Promise<string[]> {
  return (
    await readdir(join(home, "projects"), { withFileTypes: true }).catch(
      () => [],
    )
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function paths(projectId: string) {
  const root = joinCanonicalPath("projects", projectId);
  return {
    tasks: joinCanonicalPath(root, "task-definitions.json"),
    legacyTasks: joinCanonicalPath(root, "pinned-commands.json"),
    notes: joinCanonicalPath(root, "scratch-notes.json"),
    legacyNote: joinCanonicalPath(root, "scratch-note.json"),
  };
}

export const migration0005: StorageMigration = {
  id: "0005-current-project-sidecars",
  description: "Convert project task-definition and scratch-note sidecars",
  checksum: migrationChecksum(
    "0005-current-project-sidecars|v1|Convert project task-definition and scratch-note sidecars",
  ),
  async detect(context) {
    for (const projectId of await projectIds(context.paths.home)) {
      const value = paths(projectId);
      if (await pathExists(join(context.paths.home, value.legacyTasks)))
        return "pending";
      if (await pathExists(join(context.paths.home, value.legacyNote)))
        return "pending";
    }
    return "current";
  },
  async backup(context) {
    const affected: string[] = [];
    for (const projectId of await projectIds(context.paths.home))
      affected.push(...Object.values(paths(projectId)));
    return { paths: affected };
  },
  async up(context) {
    for (const projectId of await projectIds(context.paths.home)) {
      const value = paths(projectId);
      const absolute = (path: string) => join(context.paths.home, path);
      if (await pathExists(absolute(value.legacyTasks))) {
        if (await pathExists(absolute(value.tasks)))
          throw new Error(
            `Both task sidecar formats exist for project '${projectId}'.`,
          );
        const raw = await readJsonFile<unknown>(absolute(value.legacyTasks));
        if (!Array.isArray(raw))
          throw new Error(
            `Legacy task definitions for '${projectId}' are malformed.`,
          );
        const definitions = raw.map((entry) => {
          const command = pinnedCommandSchema.parse(entry);
          return taskDefinitionSchema.parse({
            id: command.id.replace(/^pin_/, "taskdef_"),
            scope: { kind: "project", projectId },
            label: command.label,
            command: command.command,
            cwd: command.cwd,
            runPolicy: "single",
            createdAt: command.createdAt,
            updatedAt: command.updatedAt,
          });
        });
        await mkdir(dirname(absolute(value.tasks)), {
          recursive: true,
          mode: 0o755,
        });
        await atomicWriteJson(absolute(value.tasks), definitions, 0o600);
        await rm(absolute(value.legacyTasks));
      }
      if (await pathExists(absolute(value.legacyNote))) {
        if (await pathExists(absolute(value.notes)))
          throw new Error(
            `Both scratch-note formats exist for project '${projectId}'.`,
          );
        const legacy = legacyScratchNoteSchema.parse(
          await readJsonFile(absolute(value.legacyNote)),
        );
        const notes =
          legacy.content.length === 0
            ? []
            : [
                scratchNoteSchema.parse({
                  id: createId("note"),
                  projectId,
                  title: SCRATCH_NOTE_DEFAULT_TITLE,
                  content: legacy.content,
                  createdAt: legacy.updatedAt,
                  updatedAt: legacy.updatedAt,
                }),
              ];
        await atomicWriteJson(absolute(value.notes), notes, 0o600);
        await rm(absolute(value.legacyNote));
      }
    }
  },
  async verify(context) {
    for (const projectId of await projectIds(context.paths.home)) {
      const value = paths(projectId);
      for (const legacy of [value.legacyTasks, value.legacyNote]) {
        if (await pathExists(join(context.paths.home, legacy)))
          throw new Error(`Legacy sidecar '${legacy}' remains.`);
      }
      if (await pathExists(join(context.paths.home, value.tasks))) {
        const raw = await readJsonFile<unknown>(
          join(context.paths.home, value.tasks),
        );
        z.array(taskDefinitionSchema).parse(raw);
      }
      if (await pathExists(join(context.paths.home, value.notes))) {
        const raw = await readJsonFile<unknown>(
          join(context.paths.home, value.notes),
        );
        z.array(scratchNoteSchema).parse(raw);
      }
    }
  },
};
