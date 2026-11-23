import { z } from "zod";

export const launchDefinitionRunPolicySchema = z.enum(["single", "concurrent"]);
export type LaunchDefinitionRunPolicy = z.infer<
  typeof launchDefinitionRunPolicySchema
>;
export const launchDefinitionPortSchema = z.number().int().min(1).max(65_535);
export const launchDefinitionScopeSchema = z.object({
  kind: z.literal("project"),
  projectId: z.string().startsWith("proj_"),
});
export type LaunchDefinitionScope = z.infer<typeof launchDefinitionScopeSchema>;
const placement = {
  parentFolderId: z.string().startsWith("launchfolder_").nullable().meta({
    description: "Id of the containing folder, or `null` for the top level.",
  }),
  order: z.number().int().nonnegative().meta({
    description:
      "Position among siblings (folders and definitions with the same parent): exactly 0, 1, ..., n-1. Renumber siblings when inserting or removing.",
  }),
};
const configuration = {
  id: z.string().startsWith("launchdef_").meta({
    description:
      "Starts with `launchdef_`; unique in the file. Use a readable suffix, e.g. `launchdef_web`.",
  }),
  label: z
    .string()
    .min(1)
    .meta({
      description:
        "Display name, and the name `launches.*` calls select it by; without it the command is the name. Give each definition a distinct name.",
    })
    .optional(),
  command: z
    .string()
    .refine((v) => v.trim().length > 0, "Command must be nonblank")
    .meta({
      description:
        "Shell command, not blank. There is no environment field; put variables in the command (`PORT=3000 pnpm dev`).",
    }),
  cwd: z
    .string()
    .min(1)
    .meta({
      description:
        "Working directory relative to the project directory. Default: the project directory. Prefer relative paths.",
    })
    .optional(),
  port: launchDefinitionPortSchema
    .meta({
      description: "Port (1-65535) the process serves, shown to the user.",
    })
    .optional(),
  runPolicy: launchDefinitionRunPolicySchema
    .meta({
      description:
        "`single`: one run at a time. `concurrent`: several runs at once. Default `single`.",
    })
    .default("single"),
  createdAt: z
    .string()
    .datetime()
    .meta({ description: "ISO 8601 date-time of creation." }),
  updatedAt: z.string().datetime().meta({
    description:
      "ISO 8601 date-time of the last change; update it when you change the definition.",
  }),
};
export const launchDefinitionSchema = z.object({
  ...configuration,
  scope: launchDefinitionScopeSchema,
  ...placement,
});
export type LaunchDefinition = z.infer<typeof launchDefinitionSchema>;
export const persistedLaunchDefinitionSchema = launchDefinitionSchema
  .extend({
    scope: z
      .object({ kind: z.literal("project") })
      .strict()
      .meta({ description: 'Always `{ "kind": "project" }`.' }),
  })
  .strict()
  .meta({ description: "A saved project command." });
export type PersistedLaunchDefinition = z.infer<
  typeof persistedLaunchDefinitionSchema
>;
export const launchFolderSchema = z
  .object({
    id: z.string().startsWith("launchfolder_").meta({
      description: "Starts with `launchfolder_`; unique in the file.",
    }),
    label: z
      .string()
      .min(1)
      .refine((v) => v === v.trim(), "Folder label must be trimmed")
      .meta({
        description:
          "Folder name without leading or trailing spaces. Unique among sibling folders, ignoring case.",
      }),
    ...placement,
  })
  .strict()
  .meta({
    description: "Organizes definitions; passes no settings to them.",
  });
export type LaunchFolder = z.infer<typeof launchFolderSchema>;
export const launchCatalogEntryRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("folder"),
    id: z.string().startsWith("launchfolder_"),
  }),
  z.object({
    kind: z.literal("definition"),
    id: z.string().startsWith("launchdef_"),
  }),
]);
export type LaunchCatalogEntryRef = z.infer<typeof launchCatalogEntryRefSchema>;
export const launchDefinitionV1FileSchema = z
  .object({
    version: z.literal(1),
    definitions: z.array(
      z
        .object({
          ...configuration,
          // Only v1 accepts the obsolete installation-local identity. Project
          // ownership is intentionally projected from the enclosing directory.
          scope: z
            .object({
              kind: z.literal("project"),
              projectId: z.string().optional(),
            })
            .strict()
            .transform(({ kind }) => ({ kind })),
        })
        .strict(),
    ),
  })
  .strict();
export const launchDefinitionFileSchema = z
  .object({
    version: z.literal(2).meta({ description: "Always 2." }),
    folders: z
      .array(launchFolderSchema)
      .meta({ description: "All folders; may be empty." }),
    definitions: z
      .array(persistedLaunchDefinitionSchema)
      .meta({ description: "All launch definitions; may be empty." }),
  })
  .strict()
  .meta({
    description:
      "Launch definitions of a project, `<project>/.nerve/launches/definitions.json`. Not expressible here: ids are unique across folders and definitions; every `parentFolderId` names an existing folder and folders form no cycles; `order` values among the children of one parent (folders and definitions together) are exactly 0..n-1; sibling folder labels are unique ignoring case.",
  })
  .superRefine((catalog, ctx) => {
    const entries = [...catalog.folders, ...catalog.definitions];
    const ids = new Set<string>();
    const folders = new Map(catalog.folders.map((f) => [f.id, f]));
    const groups = new Map<string | null, typeof entries>();
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const entry of entries) {
      if (ids.has(entry.id)) fail(`Duplicate ID: ${entry.id}`);
      ids.add(entry.id);
      if (entry.parentFolderId !== null && !folders.has(entry.parentFolderId))
        fail(`Missing parent: ${entry.parentFolderId}`);
      const siblings = groups.get(entry.parentFolderId) ?? [];
      siblings.push(entry);
      groups.set(entry.parentFolderId, siblings);
    }
    for (const siblings of groups.values()) {
      const orders = siblings.map((e) => e.order).sort((a, b) => a - b);
      if (orders.some((order, index) => order !== index))
        fail("Sibling orders must be contiguous and unique");
      const names = new Set<string>();
      for (const folder of siblings.filter((e) =>
        e.id.startsWith("launchfolder_"),
      )) {
        const key = folder.label!.trim().toLowerCase();
        if (names.has(key)) fail("Duplicate sibling folder name");
        names.add(key);
      }
    }
    for (const folder of catalog.folders) {
      const seen = new Set([folder.id]);
      let parent = folder.parentFolderId;
      while (parent !== null && folders.has(parent)) {
        if (seen.has(parent)) {
          fail("Folder cycle");
          break;
        }
        seen.add(parent);
        parent = folders.get(parent)!.parentFolderId;
      }
    }
  });
export type LaunchDefinitionFile = z.infer<typeof launchDefinitionFileSchema>;
export const launchDefinitionCatalogSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  revision: z.string(),
  folders: z.array(launchFolderSchema),
  definitions: z.array(launchDefinitionSchema),
});
export type LaunchDefinitionCatalog = z.infer<
  typeof launchDefinitionCatalogSchema
>;
export const createLaunchDefinitionRequestSchema = z.object({
  label: configuration.label,
  command: configuration.command,
  cwd: configuration.cwd,
  port: configuration.port,
  runPolicy: configuration.runPolicy,
  sourceLaunchId: z.string().startsWith("launch_").optional(),
  parentFolderId: placement.parentFolderId.default(null),
  beforeSibling: launchCatalogEntryRefSchema.nullable().default(null),
});
export type CreateLaunchDefinitionRequest = z.infer<
  typeof createLaunchDefinitionRequestSchema
>;
export const updateLaunchDefinitionRequestSchema =
  createLaunchDefinitionRequestSchema
    .omit({
      sourceLaunchId: true,
      parentFolderId: true,
      beforeSibling: true,
    })
    .extend({ runPolicy: launchDefinitionRunPolicySchema });
export type UpdateLaunchDefinitionRequest = z.infer<
  typeof updateLaunchDefinitionRequestSchema
>;
