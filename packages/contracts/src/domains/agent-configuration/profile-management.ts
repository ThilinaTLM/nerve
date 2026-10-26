import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  profileDefinitionSchema,
  configurationDiagnosticSchema,
  agentResolutionSchema,
} from "./schemas.js";
import {
  preferenceScopeSchema,
  agentScopeSchema,
  configurationMutationFailureSchema,
  profileTargetSchema,
} from "./agent-configuration-operations.js";

export const profileCatalogEntrySchema = z.strictObject({
  name: profileDefinitionSchema.shape.name,
  source: z.enum(["builtin", "user", "project"]),
  path: z.string(),
  digest: z.string().min(1),
  definition: profileDefinitionSchema.nullable(),
  trusted: z.boolean(),
  applicable: z.boolean(),
  enabled: z.boolean(),
  local: z.boolean(),
  diagnostics: z.array(configurationDiagnosticSchema),
});
export const listScopedProfilesRequestSchema = z.strictObject({
  scope: preferenceScopeSchema,
  role: z.enum(["lead", "child"]).optional(),
});
export const readScopedProfileRequestSchema =
  listScopedProfilesRequestSchema.extend({
    name: profileDefinitionSchema.shape.name,
  });
export const readScopedProfileResultSchema = z.union([
  z.strictObject({
    status: z.literal("available"),
    profile: profileCatalogEntrySchema,
    localDigest: z.string().min(1),
  }),
  configurationMutationFailureSchema,
]);
export const saveScopedProfileRequestSchema = z.strictObject({
  scope: preferenceScopeSchema,
  name: profileDefinitionSchema.shape.name,
  expectedDigest: z.string().min(1),
  definition: profileDefinitionSchema,
});
/** Removes just this complete local copy; future applications see the lower definition. */
export const deleteScopedProfileRequestSchema =
  saveScopedProfileRequestSchema.omit({ definition: true });
export const profileMutationResultSchema = z.union([
  z.strictObject({ status: z.literal("saved"), digest: z.string().min(1) }),
  configurationMutationFailureSchema,
]);
export const listScopedProfilesResultSchema = z.strictObject({
  profiles: z.array(profileCatalogEntrySchema),
  diagnostics: z.array(configurationDiagnosticSchema),
});
export const legacyConfigurationFileSchema = z.enum([
  "harness",
  "capabilities",
  "subagents",
  "integrations",
]);
export type LegacyConfigurationFile = z.infer<
  typeof legacyConfigurationFileSchema
>;
export const scopedConfigurationTargetSchema = z.union([
  z
    .strictObject({
      document: z.literal("agent"),
      scope: agentScopeSchema,
      legacyFile: legacyConfigurationFileSchema.optional(),
    })
    .superRefine((value, context) => {
      if (value.legacyFile && value.scope.scope === "conversation")
        context.addIssue({
          code: "custom",
          message: "Legacy repair is user/project only",
        });
    }),
  z.strictObject({
    document: z.literal("conversation-defaults"),
    scope: preferenceScopeSchema,
  }),
  z.strictObject({
    document: z.literal("profile"),
    scope: preferenceScopeSchema,
    name: profileDefinitionSchema.shape.name,
  }),
]);
export const scopedTrustRequestSchema = z.strictObject({
  target: z.union([
    z.strictObject({
      document: z.literal("agent"),
      scope: preferenceScopeSchema.options[1],
    }),
    z.strictObject({
      document: z.literal("profile"),
      scope: preferenceScopeSchema.options[1],
      name: profileDefinitionSchema.shape.name,
    }),
  ]),
  expectedDigest: z.string().min(1),
  trusted: z.boolean(),
});
export const scopedTrustResultSchema = z.union([
  z.strictObject({
    status: z.literal("saved"),
    digest: z.string(),
    trusted: z.boolean(),
  }),
  configurationMutationFailureSchema,
]);
export const repairPreviewRequestSchema = z.strictObject({
  target: scopedConfigurationTargetSchema,
  replacement: z.unknown(),
  targetProfile: profileTargetSchema.optional(),
});
export const repairPreviewSchema = z.strictObject({
  target: scopedConfigurationTargetSchema,
  sourceDigest: z.string(),
  candidateDigest: z.string(),
  candidateVersion: z.number().int(),
  candidate: z.unknown(),
  changedPaths: z.array(z.string()),
  resolution: agentResolutionSchema.optional(),
  targetProfile: profileTargetSchema.optional(),
});
export const repairPreviewResultSchema = z.union([
  z.strictObject({ status: z.literal("ready"), preview: repairPreviewSchema }),
  configurationMutationFailureSchema,
]);
export const repairApplyRequestSchema = repairPreviewSchema.omit({
  changedPaths: true,
  resolution: true,
});
export const repairApplyResultSchema = z.union([
  z.strictObject({
    status: z.literal("saved"),
    digest: z.string(),
    backupPath: z.string().nullable(),
    receiptPath: z.string(),
    durability: z.enum(["synchronized", "unsupported"]),
  }),
  configurationMutationFailureSchema,
]);
export const reloadConfigurationRequestSchema = z.strictObject({
  target: scopedConfigurationTargetSchema,
});
export const reloadConfigurationResultSchema = z.strictObject({
  status: z.literal("reloaded"),
  diagnostics: z.array(configurationDiagnosticSchema),
});
const host = ["workbench_server"] as const;
export const scopedProfileOperationDefinitions = [
  defineOperation(
    "agentConfiguration.reload",
    reloadConfigurationRequestSchema,
    reloadConfigurationResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentConfiguration.reload",
  ),
  defineOperation(
    "agentProfiles.list",
    listScopedProfilesRequestSchema,
    listScopedProfilesResultSchema,
    "read",
    "none",
    host,
    "operation.agentProfiles.list",
  ),
  defineOperation(
    "agentProfiles.read",
    readScopedProfileRequestSchema,
    readScopedProfileResultSchema,
    "read",
    "none",
    host,
    "operation.agentProfiles.read",
  ),
  defineOperation(
    "agentProfiles.save",
    saveScopedProfileRequestSchema,
    profileMutationResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.save",
  ),
  defineOperation(
    "agentProfiles.delete",
    deleteScopedProfileRequestSchema,
    profileMutationResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.delete",
  ),
  defineOperation(
    "agentProfiles.reset",
    deleteScopedProfileRequestSchema,
    profileMutationResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.reset",
  ),
  defineOperation(
    "agentProfiles.trust",
    scopedTrustRequestSchema,
    scopedTrustResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.trust",
  ),
  defineOperation(
    "agentConfiguration.trust",
    scopedTrustRequestSchema,
    scopedTrustResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentConfiguration.trust",
  ),
  defineOperation(
    "agentConfiguration.repairPreview",
    repairPreviewRequestSchema,
    repairPreviewResultSchema,
    "read",
    "none",
    host,
    "operation.agentConfiguration.repairPreview",
  ),
  defineOperation(
    "agentConfiguration.repairApply",
    repairApplyRequestSchema,
    repairApplyResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentConfiguration.repairApply",
  ),
] as const;
export type ProfileCatalogEntry = z.infer<typeof profileCatalogEntrySchema>;
export type ScopedConfigurationTarget = z.infer<
  typeof scopedConfigurationTargetSchema
>;
export type ScopedTrustRequest = z.infer<typeof scopedTrustRequestSchema>;
export type RepairPreviewRequest = z.infer<typeof repairPreviewRequestSchema>;
export type RepairApplyRequest = z.infer<typeof repairApplyRequestSchema>;
export type RepairPreview = z.infer<typeof repairPreviewSchema>;

export type ListScopedProfilesRequest = z.infer<
  typeof listScopedProfilesRequestSchema
>;
export type ListScopedProfilesResult = z.infer<
  typeof listScopedProfilesResultSchema
>;
export type ReadScopedProfileRequest = z.infer<
  typeof readScopedProfileRequestSchema
>;
export type ReadScopedProfileResult = z.infer<
  typeof readScopedProfileResultSchema
>;
export type SaveScopedProfileRequest = z.infer<
  typeof saveScopedProfileRequestSchema
>;
export type DeleteScopedProfileRequest = z.infer<
  typeof deleteScopedProfileRequestSchema
>;
export type ProfileMutationResult = z.infer<typeof profileMutationResultSchema>;
export type ScopedTrustResult = z.infer<typeof scopedTrustResultSchema>;
export type RepairPreviewResult = z.infer<typeof repairPreviewResultSchema>;
export type RepairApplyResult = z.infer<typeof repairApplyResultSchema>;

export type ProfileDefinition = z.infer<typeof profileDefinitionSchema>;

export type ReloadConfigurationRequest = z.infer<
  typeof reloadConfigurationRequestSchema
>;
export type ReloadConfigurationResult = z.infer<
  typeof reloadConfigurationResultSchema
>;
