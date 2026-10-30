import { z } from "zod";

export const projectConfigurationIssueSchema = z.object({
  projectId: z.string(),
  type: z.string(),
  label: z.string(),
  resetDescription: z.string(),
  path: z
    .string()
    .refine(
      (path) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path),
      "Expected an absolute configuration path",
    ),
  classification: z.enum(["migrated", "corrupted", "incompatible"]),
  message: z.string(),
  resetOffered: z.boolean(),
});
export type ProjectConfigurationIssue = z.infer<
  typeof projectConfigurationIssueSchema
>;
export const projectConfigurationHealthSchema = z.object({
  projectId: z.string(),
  issues: z.array(projectConfigurationIssueSchema),
});
export type ProjectConfigurationHealth = z.infer<
  typeof projectConfigurationHealthSchema
>;
export const resolveProjectConfigurationSchema = z.discriminatedUnion(
  "action",
  [
    z.object({ action: z.literal("reload"), type: z.string() }),
    z.object({
      action: z.literal("reset"),
      type: z.string(),
      confirmed: z.literal(true),
    }),
  ],
);
export type ResolveProjectConfiguration = z.infer<
  typeof resolveProjectConfigurationSchema
>;
