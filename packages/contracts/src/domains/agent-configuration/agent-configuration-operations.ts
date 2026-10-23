import { z } from "zod";
import { agentProfileNameSchema } from "../agent-profiles/constants.js";
import {
  agentPreferencesSchema,
  profileDefinitionSchema,
  fieldProvenanceSchema,
  appliedProfileSchema,
  agentResolutionSchema,
  configurationDiagnosticSchema,
  conversationDefaultsSchema,
  leadSettingsOverridesSchema,
  sha256HexSchema,
  childLaunchOverridesSchema,
} from "./schemas.js";
import { agentMutationSchema, applySettingsMutation } from "./resolver.js";

export const preferenceScopeSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("user") }),
  z.strictObject({ scope: z.literal("project"), projectId: z.string().min(1) }),
]);
export const agentScopeSchema = z.discriminatedUnion("scope", [
  ...preferenceScopeSchema.options,
  z.strictObject({
    scope: z.literal("conversation"),
    conversationId: z.string().min(1),
  }),
]);
export const configurationVersionSchema = z.strictObject({
  revision: agentPreferencesSchema.shape.revision,
  digest: agentMutationSchema.shape.expectedDigest,
});
export const configurationDocumentSourceSchema =
  configurationVersionSchema.extend({
    scope: agentScopeSchema,
    path: z.string().min(1),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  });
const diagnostics = z.array(configurationDiagnosticSchema);
export const configurationConflictSchema = z.strictObject({
  status: z.literal("conflict"),
  current: configurationVersionSchema.optional(),
  diagnostics,
});
export const configurationUnavailableSchema = z.strictObject({
  status: z.literal("unavailable"),
  diagnostics: diagnostics.min(1),
});
export const configurationInvalidSchema = z.strictObject({
  status: z.literal("invalid"),
  diagnostics: diagnostics.min(1),
});
export const configurationMutationFailureSchema = z.discriminatedUnion(
  "status",
  [
    configurationConflictSchema,
    configurationUnavailableSchema,
    configurationInvalidSchema,
  ],
);
export const getAgentConfigurationRequestSchema = z.strictObject({
  scope: agentScopeSchema,
});
export const getAgentConfigurationResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("available"),
      source: configurationDocumentSourceSchema,
      overrides: leadSettingsOverridesSchema,
    }),
    configurationUnavailableSchema,
  ],
);
export const saveAgentConfigurationRequestSchema = agentMutationSchema
  .extend({ scope: agentScopeSchema })
  .superRefine((value, ctx) => {
    try {
      applySettingsMutation(
        {},
        {
          expectedRevision: value.expectedRevision,
          expectedDigest: value.expectedDigest,
          changes: value.changes,
          resets: value.resets,
        },
      );
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid, overlapping or non-canonical mutation paths",
      });
    }
  });
export const saveAgentConfigurationResultSchema = z.union([
  z.strictObject({
    status: z.literal("saved"),
    source: configurationDocumentSourceSchema,
    overrides: leadSettingsOverridesSchema,
  }),
  configurationMutationFailureSchema,
]);
export const effectiveAgentViewSchema = z.strictObject({
  status: z.literal("available"),
  conversationId: z.string().min(1),
  role: z.enum(["lead", "child"]),
  appliedProfile: appliedProfileSchema.nullable(),
  resolution: agentResolutionSchema,
  diagnostics,
  sources: z.array(configurationDocumentSourceSchema),
});
export const getEffectiveAgentRequestSchema = z.strictObject({
  conversationId: z.string().min(1),
});
export const effectiveAgentViewResultSchema = z.discriminatedUnion("status", [
  effectiveAgentViewSchema,
  configurationUnavailableSchema.extend({ conversationId: z.string().min(1) }),
]);

export const creationPreferencesMutationSchema = z
  .strictObject({
    expectedRevision: agentMutationSchema.shape.expectedRevision,
    expectedDigest: agentMutationSchema.shape.expectedDigest,
    changes: conversationDefaultsSchema.shape.overrides,
    resets: z.array(
      z.enum(["/overrides/defaultAgentProfile", "/overrides/scopedModels"]),
    ),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.resets).size !== v.resets.length ||
      v.resets.some((path) =>
        Object.hasOwn(v.changes, path.slice("/overrides/".length)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Overlapping creation preference operations",
      });
  });
const creationSource = configurationDocumentSourceSchema.extend({
  scope: preferenceScopeSchema,
});
export const getCreationPreferencesRequestSchema = z.strictObject({
  scope: preferenceScopeSchema,
});
export const getCreationPreferencesResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("available"),
      source: creationSource,
      overrides: conversationDefaultsSchema.shape.overrides,
      effective: conversationDefaultsSchema.shape.overrides.required({
        defaultAgentProfile: true,
      }),
      diagnostics,
    }),
    configurationUnavailableSchema,
  ],
);
export const saveCreationPreferencesRequestSchema =
  creationPreferencesMutationSchema.safeExtend({
    scope: preferenceScopeSchema,
  });
export const saveCreationPreferencesResultSchema = z.union([
  z.strictObject({
    status: z.literal("saved"),
    source: creationSource,
    overrides: conversationDefaultsSchema.shape.overrides,
  }),
  configurationMutationFailureSchema,
]);

/** Current project catalog name and exact definition bytes, not an alternate source namespace. */
export const profileTargetSchema = z.strictObject({
  name: agentProfileNameSchema,
  digest: sha256HexSchema,
});
/** No defaults: only submitted choices become explicit overrides. */
export const implementationChoicesSchema = childLaunchOverridesSchema;
export const profileConfirmationSchema = z.strictObject({
  targetProfile: profileTargetSchema,
  expectedRevision: agentMutationSchema.shape.expectedRevision,
  expectedDigest: agentMutationSchema.shape.expectedDigest,
  transitionId: z.string().min(1),
  choices: implementationChoicesSchema.optional(),
});
export const profileTransitionPreviewSchema = z.strictObject({
  targetDefinition: profileDefinitionSchema,
  changedFields: z.array(
    z.strictObject({
      pointer: z.string(),
      before: z.unknown(),
      after: z.unknown(),
      beforeSource: fieldProvenanceSchema.optional(),
      afterSource: fieldProvenanceSchema.optional(),
    }),
  ),
  unchangedRequirements: z.array(
    z.strictObject({ pointer: z.string(), value: z.unknown() }),
  ),
  targetProfile: profileTargetSchema,
  source: z.enum(["builtin", "user", "project"]),
  expectedRevision: agentMutationSchema.shape.expectedRevision,
  expectedDigest: agentMutationSchema.shape.expectedDigest,
  recommendations: leadSettingsOverridesSchema,
  requirements: leadSettingsOverridesSchema,
  resolution: agentResolutionSchema,
});
export const profileRefreshRequiredSchema = z.strictObject({
  status: z.literal("refresh_required"),
  reason: z.enum([
    "target_changed",
    "target_unavailable",
    "target_untrusted",
    "requirement_conflict",
    "configuration_changed",
  ]),
  diagnostics,
  preview: profileTransitionPreviewSchema.optional(),
});
export const previewProfileTransitionRequestSchema = z.strictObject({
  conversationId: z.string().min(1),
  profile: agentProfileNameSchema,
});
export const previewProfileTransitionResultSchema = z.union([
  z.strictObject({
    status: z.literal("ready"),
    preview: profileTransitionPreviewSchema,
  }),
  profileRefreshRequiredSchema,
  configurationUnavailableSchema,
]);
export const setConversationAgentProfileRequestSchema =
  profileConfirmationSchema.omit({ choices: true }).extend({
    conversationId: z.string().min(1),
    action: z.enum(["switch", "reapply"]),
  });
export const profileTransitionResultSchema = z.union([
  z.strictObject({
    status: z.literal("applied"),
    transitionId: z.string().min(1),
    source: configurationDocumentSourceSchema.extend({
      scope: agentScopeSchema.options[2],
    }),
    effective: effectiveAgentViewResultSchema,
  }),
  profileRefreshRequiredSchema,
  configurationUnavailableSchema,
]);
export const planReviewResolutionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    kind: z.literal("plan_review"),
    decision: z.literal("approve"),
    confirmation: profileConfirmationSchema,
    feedback: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("plan_review"),
    decision: z.literal("reject"),
    feedback: z.string().optional(),
  }),
]);
export const interactionResolveResultSchema = z.union([
  z.strictObject({ status: z.literal("resolved") }),
  profileTransitionResultSchema,
]);

export type AgentScope = z.infer<typeof agentScopeSchema>;
export type PreferenceScope = z.infer<typeof preferenceScopeSchema>;
export type ConfigurationDocumentSource = z.infer<
  typeof configurationDocumentSourceSchema
>;
export type SaveAgentConfigurationRequest = z.infer<
  typeof saveAgentConfigurationRequestSchema
>;
export type SaveAgentConfigurationResult = z.infer<
  typeof saveAgentConfigurationResultSchema
>;
export type EffectiveAgentView = z.infer<typeof effectiveAgentViewResultSchema>;
export type CreationPreferencesMutation = z.infer<
  typeof creationPreferencesMutationSchema
>;
export type SaveCreationPreferencesRequest = z.infer<
  typeof saveCreationPreferencesRequestSchema
>;
export type SaveCreationPreferencesResult = z.infer<
  typeof saveCreationPreferencesResultSchema
>;
export type ProfileTarget = z.infer<typeof profileTargetSchema>;
export type ProfileConfirmation = z.infer<typeof profileConfirmationSchema>;
export type ImplementationChoices = z.infer<typeof implementationChoicesSchema>;
export type ProfileTransitionPreview = z.infer<
  typeof profileTransitionPreviewSchema
>;
export type ProfileRefreshRequired = z.infer<
  typeof profileRefreshRequiredSchema
>;
export type ProfileTransitionResult = z.infer<
  typeof profileTransitionResultSchema
>;
export type SetConversationAgentProfileRequest = z.infer<
  typeof setConversationAgentProfileRequestSchema
>;
export type InteractionResolveResult = z.infer<
  typeof interactionResolveResultSchema
>;
export type ConfigurationVersion = z.infer<typeof configurationVersionSchema>;
export type ConfigurationMutationFailure = z.infer<
  typeof configurationMutationFailureSchema
>;
export type GetAgentConfigurationRequest = z.infer<
  typeof getAgentConfigurationRequestSchema
>;
export type GetAgentConfigurationResult = z.infer<
  typeof getAgentConfigurationResultSchema
>;
export type GetEffectiveAgentRequest = z.infer<
  typeof getEffectiveAgentRequestSchema
>;
export type GetCreationPreferencesRequest = z.infer<
  typeof getCreationPreferencesRequestSchema
>;
export type GetCreationPreferencesResult = z.infer<
  typeof getCreationPreferencesResultSchema
>;
export type PreviewProfileTransitionRequest = z.infer<
  typeof previewProfileTransitionRequestSchema
>;
export type PreviewProfileTransitionResult = z.infer<
  typeof previewProfileTransitionResultSchema
>;
export type PlanReviewResolution = z.infer<typeof planReviewResolutionSchema>;
