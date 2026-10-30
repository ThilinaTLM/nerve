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
    legacyFiles: ["tasks/definitions.json"],
    schema: launchDefinitionFileSchema,
    fallback: empty,
    reset: empty,
  };
