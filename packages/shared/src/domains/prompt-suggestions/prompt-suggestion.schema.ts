import { z } from "zod";
import { modeSchema, permissionLevelSchema } from "../settings/index.js";

export const promptSuggestionSourceKindSchema = z.enum(["user", "project"]);
export type PromptSuggestionSourceKind = z.infer<
  typeof promptSuggestionSourceKindSchema
>;

export const promptSuggestionTrustStatusSchema = z.enum([
  "unset",
  "allowed",
  "denied",
  "not_required",
  "stale",
]);
export type PromptSuggestionTrustStatus = z.infer<
  typeof promptSuggestionTrustStatusSchema
>;

export const promptSuggestionSourceSchema = z.object({
  kind: promptSuggestionSourceKindSchema,
  path: z.string().min(1),
  projectId: z.string().startsWith("proj_").optional(),
});
export type PromptSuggestionSource = z.infer<
  typeof promptSuggestionSourceSchema
>;

export const promptSuggestionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  order: z.number(),
  source: promptSuggestionSourceSchema,
  requiresTrust: z.boolean(),
  trustStatus: promptSuggestionTrustStatusSchema,
});
export type PromptSuggestion = z.infer<typeof promptSuggestionSchema>;

export const promptSuggestionTrustRequestSchema = z.object({
  trustId: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  path: z.string().min(1),
  sourceKind: promptSuggestionSourceKindSchema,
  projectId: z.string().startsWith("proj_").optional(),
  predicateHash: z.string().min(1),
});
export type PromptSuggestionTrustRequest = z.infer<
  typeof promptSuggestionTrustRequestSchema
>;

export const promptSuggestionStatusSchema = z.object({
  trustId: z.string().min(1).optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  path: z.string().min(1),
  sourceKind: promptSuggestionSourceKindSchema,
  projectId: z.string().startsWith("proj_").optional(),
  requiresTrust: z.boolean(),
  status: promptSuggestionTrustStatusSchema,
  predicateHash: z.string().min(1).optional(),
  stale: z.boolean().optional(),
});
export type PromptSuggestionStatus = z.infer<
  typeof promptSuggestionStatusSchema
>;

export const promptSuggestionDiagnosticSchema = z.object({
  type: z.literal("warning"),
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().min(1),
});
export type PromptSuggestionDiagnostic = z.infer<
  typeof promptSuggestionDiagnosticSchema
>;

export const promptSuggestionListResponseSchema = z.object({
  suggestions: z.array(promptSuggestionSchema),
  trustRequests: z.array(promptSuggestionTrustRequestSchema),
  statuses: z.array(promptSuggestionStatusSchema),
  diagnostics: z.array(promptSuggestionDiagnosticSchema).optional(),
});
export type PromptSuggestionListResponse = z.infer<
  typeof promptSuggestionListResponseSchema
>;

export const updatePromptSuggestionTrustRequestSchema = z.object({
  trustId: z.string().min(1),
  status: z.enum(["allowed", "denied", "unset"]),
});
export type UpdatePromptSuggestionTrustRequest = z.infer<
  typeof updatePromptSuggestionTrustRequestSchema
>;

export const promptSuggestionWhenSchema = z.object({
  gitDirty: z.boolean().optional(),
  hasRepos: z.boolean().optional(),
  githubAuthenticated: z.boolean().optional(),
  modes: z.array(modeSchema).optional(),
  permissionLevels: z.array(permissionLevelSchema).optional(),
});
export type PromptSuggestionWhen = z.infer<typeof promptSuggestionWhenSchema>;
