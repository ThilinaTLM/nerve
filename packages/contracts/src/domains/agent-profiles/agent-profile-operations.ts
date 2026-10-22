import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { defineOperation } from "../../operations/definition.js";
import { agentProfileNameSchema } from "./constants.js";
import {
  agentProfileSchema,
  agentProfileScopeSchema,
  agentProfileFieldsSchema,
} from "./agent-profile.js";

import {
  agentProfilePatchSchema,
  agentProfilesConfigurationSchema,
  agentProfilesDraftSchema,
} from "./agent-profile-configuration.js";

const projectIdSchema = z.string().startsWith("proj_");
const host = ["workbench_server"] as const;

/** Scope plus project; `projectId` is required when `scope` is `project`. */
const scopedParams = {
  scope: agentProfileScopeSchema,
  projectId: projectIdSchema.optional(),
  conversationId: z.string().min(1).optional(),
};
function requireProjectForProjectScope(
  value: { scope: string; projectId?: string; conversationId?: string },
  context: z.RefinementCtx,
) {
  if (value.scope === "conversation" && !value.conversationId)
    context.addIssue({
      code: "custom",
      path: ["conversationId"],
      message: "conversationId is required for conversation scope",
    });
  if (value.scope === "project" && !value.projectId)
    context.addIssue({
      code: "custom",
      path: ["projectId"],
      message: "projectId is required for project scope",
    });
}

export const agentProfilesListParamsSchema = z.object({
  projectId: projectIdSchema.optional(),
  conversationId: z.string().min(1).optional(),
});
export const agentProfilesConfigurationParamsSchema = z
  .object(scopedParams)
  .superRefine(requireProjectForProjectScope);
export const agentProfilesConfigurationResultSchema =
  agentProfilesConfigurationSchema;
export const agentProfilesLeadContextSchema = z
  .object({
    model: modelSelectionSchema,
    reasoningLevel: thinkingLevelSchema,
  })
  .strict();
export type AgentProfilesLeadContext = z.infer<
  typeof agentProfilesLeadContextSchema
>;
export const agentProfilesPreviewParamsSchema = z
  .object({
    projectId: projectIdSchema,
    profiles: agentProfilesDraftSchema,
    lead: agentProfilesLeadContextSchema,
  })
  .strict();
export const agentProfilesPreviewResultSchema =
  agentProfilesConfigurationSchema;
const mutationParams = {
  ...scopedParams,
  name: agentProfileNameSchema,
  /** Null asserts the file is absent; omitted disables optimistic concurrency. */
  expectedDigest: z.string().min(1).nullable().optional(),
};
export const agentProfilesUpdateParamsSchema = z
  .object({
    ...mutationParams,
    patch: agentProfilePatchSchema,
  })
  .superRefine(requireProjectForProjectScope);
export const agentProfilesUpdateResultSchema = agentProfilesConfigurationSchema;
export const agentProfilesResetParamsSchema = z
  .object({
    ...mutationParams,
    /** Omit to remove the local entry. */
    field: z
      .enum([...agentProfileFieldsSchema.keyof().options, "instructions"])
      .optional(),
  })
  .superRefine(requireProjectForProjectScope);
export const agentProfilesResetResultSchema = agentProfilesConfigurationSchema;
export const agentProfilesListResultSchema = z.object({
  /** Resolved profiles; blocked profiles carry an error and are never advertised. */
  profiles: z.array(agentProfileSchema),
});
export const agentProfilesTrustParamsSchema = z.object({
  projectId: projectIdSchema,
  name: agentProfileNameSchema,
  digest: z.string().min(1),
});

export const agentProfilesTrustResultSchema = agentProfilesConfigurationSchema;

export const agentProfilesOperationDefinitions = [
  defineOperation(
    "agentProfiles.preview",
    agentProfilesPreviewParamsSchema,
    agentProfilesPreviewResultSchema,
    "read",
    "none",
    host,
    "operation.agentProfiles.preview",
  ),
  defineOperation(
    "agentProfiles.list",
    agentProfilesListParamsSchema.optional(),
    agentProfilesListResultSchema,
    "read",
    "none",
    host,
    "operation.agentProfiles.list",
  ),
  defineOperation(
    "agentProfiles.configuration",
    agentProfilesConfigurationParamsSchema,
    agentProfilesConfigurationResultSchema,
    "read",
    "none",
    host,
    "operation.agentProfiles.configuration",
  ),
  defineOperation(
    "agentProfiles.update",
    agentProfilesUpdateParamsSchema,
    agentProfilesUpdateResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.update",
  ),
  defineOperation(
    "agentProfiles.reset",
    agentProfilesResetParamsSchema,
    agentProfilesResetResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.reset",
  ),
  defineOperation(
    "agentProfiles.trust",
    agentProfilesTrustParamsSchema,
    agentProfilesTrustResultSchema,
    "mutation",
    "none",
    host,
    "operation.agentProfiles.trust",
  ),
] as const;
