import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { defineOperation } from "../../operations/definition.js";
import { subagentProfileNameSchema } from "./constants.js";
import {
  subagentProfileSchema,
  subagentProfileScopeSchema,
} from "./subagent-profile.js";

import {
  subagentProfileEntrySchema,
  subagentProfilePatchSchema,
  subagentProfilesConfigurationSchema,
  subagentProfilesDocumentSchema,
} from "./subagent-configuration.js";

const projectIdSchema = z.string().startsWith("proj_");
const host = ["workbench_server"] as const;

/** Scope plus project; `projectId` is required when `scope` is `project`. */
const scopedParams = {
  scope: subagentProfileScopeSchema,
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

export const subagentProfilesListParamsSchema = z.object({
  projectId: projectIdSchema.optional(),
  conversationId: z.string().min(1).optional(),
});
export const subagentProfilesConfigurationParamsSchema = z
  .object(scopedParams)
  .superRefine(requireProjectForProjectScope);
export const subagentProfilesConfigurationResultSchema =
  subagentProfilesConfigurationSchema;
export const subagentProfilesLeadContextSchema = z
  .object({
    model: modelSelectionSchema,
    reasoningLevel: thinkingLevelSchema,
  })
  .strict();
export type SubagentProfilesLeadContext = z.infer<
  typeof subagentProfilesLeadContextSchema
>;
export const subagentProfilesPreviewParamsSchema = z
  .object({
    projectId: projectIdSchema,
    document: subagentProfilesDocumentSchema,
    lead: subagentProfilesLeadContextSchema,
  })
  .strict();
export const subagentProfilesPreviewResultSchema =
  subagentProfilesConfigurationSchema;
export const subagentProfilesReplaceConversationParamsSchema = z
  .object({
    projectId: projectIdSchema,
    conversationId: z.string().min(1),
    document: subagentProfilesDocumentSchema,
    expectedDigest: z.string().min(1).nullable(),
  })
  .strict();
export const subagentProfilesReplaceConversationResultSchema =
  subagentProfilesConfigurationSchema;
const mutationParams = {
  ...scopedParams,
  name: subagentProfileNameSchema,
  /** Null asserts the file is absent; omitted disables optimistic concurrency. */
  expectedDigest: z.string().min(1).nullable().optional(),
};
export const subagentProfilesUpdateParamsSchema = z
  .object({
    ...mutationParams,
    patch: subagentProfilePatchSchema,
  })
  .superRefine(requireProjectForProjectScope);
export const subagentProfilesUpdateResultSchema =
  subagentProfilesConfigurationSchema;
export const subagentProfilesResetParamsSchema = z
  .object({
    ...mutationParams,
    /** Omit to remove the local entry. */
    field: subagentProfileEntrySchema.keyof().optional(),
  })
  .superRefine(requireProjectForProjectScope);
export const subagentProfilesResetResultSchema =
  subagentProfilesConfigurationSchema;
export const subagentProfilesListResultSchema = z.object({
  /** Resolved profiles; blocked profiles carry an error and are never advertised. */
  profiles: z.array(subagentProfileSchema),
});
export const subagentProfilesTrustParamsSchema = z.object({
  projectId: projectIdSchema,
  digest: z.string().min(1),
});

export const subagentProfilesTrustResultSchema =
  subagentProfilesConfigurationSchema;

export const subagentProfilesOperationDefinitions = [
  defineOperation(
    "subagentProfiles.preview",
    subagentProfilesPreviewParamsSchema,
    subagentProfilesPreviewResultSchema,
    "read",
    "none",
    host,
    "operation.subagentProfiles.preview",
  ),
  defineOperation(
    "subagentProfiles.replaceConversation",
    subagentProfilesReplaceConversationParamsSchema,
    subagentProfilesReplaceConversationResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.replaceConversation",
  ),
  defineOperation(
    "subagentProfiles.list",
    subagentProfilesListParamsSchema.optional(),
    subagentProfilesListResultSchema,
    "read",
    "none",
    host,
    "operation.subagentProfiles.list",
  ),
  defineOperation(
    "subagentProfiles.configuration",
    subagentProfilesConfigurationParamsSchema,
    subagentProfilesConfigurationResultSchema,
    "read",
    "none",
    host,
    "operation.subagentProfiles.configuration",
  ),
  defineOperation(
    "subagentProfiles.update",
    subagentProfilesUpdateParamsSchema,
    subagentProfilesUpdateResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.update",
  ),
  defineOperation(
    "subagentProfiles.reset",
    subagentProfilesResetParamsSchema,
    subagentProfilesResetResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.reset",
  ),
  defineOperation(
    "subagentProfiles.trust",
    subagentProfilesTrustParamsSchema,
    subagentProfilesTrustResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.trust",
  ),
] as const;
