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
  parentFolderId: z.string().startsWith("launchfolder_").nullable(),
  order: z.number().int().nonnegative(),
};
const configuration = {
  id: z.string().startsWith("launchdef_"),
  label: z.string().min(1).optional(),
  command: z
    .string()
    .refine((v) => v.trim().length > 0, "Command must be nonblank"),
  cwd: z.string().min(1).optional(),
  port: launchDefinitionPortSchema.optional(),
  runPolicy: launchDefinitionRunPolicySchema.default("single"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const launchDefinitionSchema = z.object({
  ...configuration,
  scope: launchDefinitionScopeSchema,
  ...placement,
});
export type LaunchDefinition = z.infer<typeof launchDefinitionSchema>;
export const persistedLaunchDefinitionSchema = launchDefinitionSchema
  .extend({
    scope: z.object({ kind: z.literal("project") }).strict(),
  })
  .strict();
export type PersistedLaunchDefinition = z.infer<
  typeof persistedLaunchDefinitionSchema
>;
export const launchFolderSchema = z
  .object({
    id: z.string().startsWith("launchfolder_"),
    label: z
      .string()
      .min(1)
      .refine((v) => v === v.trim(), "Folder label must be trimmed"),
    ...placement,
  })
  .strict();
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
    version: z.literal(2),
    folders: z.array(launchFolderSchema),
    definitions: z.array(persistedLaunchDefinitionSchema),
  })
  .strict()
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
