import { createHash } from "node:crypto";
import { z } from "zod";
import {
  launchDefinitionFileSchema,
  type LaunchDefinitionFile,
} from "@nervekit/contracts/launch-definitions";
import type { ProjectConfigurationType } from "../../infrastructure/configuration/project-migration/project-migration.js";

// Frozen v1 shapes: never import a current definition shape into an old migrator.
const v1Definition = z
  .object({
    id: z.string().startsWith("launchdef_"),
    scope: z
      .object({ kind: z.literal("project"), projectId: z.string().optional() })
      .strict(),
    label: z.string().min(1).optional(),
    command: z.string().refine((value) => value.trim().length > 0),
    cwd: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    runPolicy: z.enum(["single", "concurrent"]).default("single"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const v1 = z
  .object({ version: z.literal(1), definitions: z.array(v1Definition) })
  .strict();
const tasksV1 = v1.extend({
  definitions: z.array(
    v1Definition.extend({ id: z.string().startsWith("taskdef_") }),
  ),
});
export function migrateLaunchesV1(value: unknown): unknown {
  const old = v1.parse(value);
  return {
    version: 2,
    folders: [],
    definitions: old.definitions.map((definition, order) => ({
      ...definition,
      scope: { kind: "project" },
      parentFolderId: null,
      order,
    })),
  };
}
export function migrateLegacyTasks(value: unknown): unknown {
  const raw = value as Record<string, unknown>;
  const old = tasksV1.parse({ ...raw, version: raw?.version ?? 1 });
  return {
    version: 1,
    definitions: old.definitions.map((definition) => ({
      ...definition,
      id: definition.id.replace(/^taskdef_/, "launchdef_"),
    })),
  };
}
const empty = (): LaunchDefinitionFile => ({
  version: 2,
  folders: [],
  definitions: [],
});
export const launchDefinitionsConfiguration: ProjectConfigurationType<LaunchDefinitionFile> =
  {
    id: "launch-definitions",
    label: "Launch definitions",
    resetDescription: "All launch definitions in this project will be removed.",
    path: "launches/definitions.json",
    currentVersion: 2,
    version: { field: "version", absent: 1 },
    migrators: { 1: migrateLaunchesV1 },
    legacySources: [
      {
        path: "tasks/definitions.json",
        currentVersion: 1,
        migrate: migrateLegacyTasks,
      },
      {
        root: "home",
        path: ({ projectId }) =>
          `data/launches/legacy/${createHash("sha256").update(projectId).digest("hex")}.json`,
        currentVersion: 1,
        migrate: migrateLegacyTasks,
      },
    ],
    schema: launchDefinitionFileSchema,
    fallback: empty,
    reset: empty,
  };
