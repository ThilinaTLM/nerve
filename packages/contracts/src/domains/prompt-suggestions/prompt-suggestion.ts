import { z } from "zod";
import { permissionLevelSchema } from "../permissions/permissions.js";
import { modeSchema } from "../settings/settings.js";

export const PROMPT_SUGGESTION_NAME_MAX_LENGTH = 64;
export const PROMPT_SUGGESTION_LABEL_MAX_LENGTH = 80;
export const PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH = 1024;
export const PROMPT_SUGGESTION_PROMPT_MAX_LENGTH = 100_000;

export const promptSuggestionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROMPT_SUGGESTION_NAME_MAX_LENGTH)
  .regex(
    /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Name must use lowercase letters, numbers, and single hyphens",
  );

export const promptSuggestionSourceKindSchema = z.enum([
  "builtin",
  "user",
  "project",
]);
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
  definitionKey: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  path: z.string().min(1),
  sourceKind: promptSuggestionSourceKindSchema,
  projectId: z.string().startsWith("proj_").optional(),
  requiresTrust: z.boolean(),
  status: promptSuggestionTrustStatusSchema,
  enabled: z.boolean(),
  defaultEnabled: z.boolean(),
  overriddenBy: promptSuggestionSourceKindSchema.optional(),
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

export const updatePromptSuggestionEnabledRequestSchema = z.object({
  definitionKey: z.string().min(1),
  enabled: z.boolean(),
});
export type UpdatePromptSuggestionEnabledRequest = z.infer<
  typeof updatePromptSuggestionEnabledRequestSchema
>;

export const createPromptSuggestionRequestSchema = z
  .object({
    scope: z.enum(["user", "project"]),
    projectId: z.string().startsWith("proj_").optional(),
    name: promptSuggestionNameSchema,
    label: z.string().trim().min(1).max(PROMPT_SUGGESTION_LABEL_MAX_LENGTH),
    description: z
      .string()
      .trim()
      .max(PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH)
      .optional(),
    prompt: z.string().trim().min(1).max(PROMPT_SUGGESTION_PROMPT_MAX_LENGTH),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "project" && !value.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project scope requires a projectId",
      });
    }
    if (value.scope === "user" && value.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "User scope must not include a projectId",
      });
    }
  });
export type CreatePromptSuggestionRequest = z.infer<
  typeof createPromptSuggestionRequestSchema
>;

export const createPromptSuggestionResponseSchema = z.object({
  suggestion: promptSuggestionStatusSchema,
});
export type CreatePromptSuggestionResponse = z.infer<
  typeof createPromptSuggestionResponseSchema
>;

export const promptSuggestionWhenSchema = z.object({
  gitDirty: z.boolean().optional(),
  hasRepos: z.boolean().optional(),
  githubAuthenticated: z.boolean().optional(),
  modes: z.array(modeSchema).optional(),
  permissionLevels: z.array(permissionLevelSchema).optional(),
});
export type PromptSuggestionWhen = z.infer<typeof promptSuggestionWhenSchema>;
