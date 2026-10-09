import { z } from "zod";

export const trustedResourceKindSchema = z.enum([
  "prompt_suggestion",
  "skill",
  "project_permissions",
  "project_capabilities",
]);
export const trustedResourceStatusSchema = z.enum(["trusted", "rejected"]);
export const trustedResourceSchema = z.object({
  id: z.string(),
  kind: trustedResourceKindSchema,
  projectId: z.string().nullable(),
  path: z.string(),
  name: z.string().nullable(),
  contentDigest: z.string(),
  status: trustedResourceStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TrustedResourceKind = z.infer<typeof trustedResourceKindSchema>;
export type TrustedResourceStatus = z.infer<typeof trustedResourceStatusSchema>;
export type TrustedResource = z.infer<typeof trustedResourceSchema>;
