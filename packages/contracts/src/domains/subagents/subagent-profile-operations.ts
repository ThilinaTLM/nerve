import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { subagentProfileNameSchema } from "./constants.js";
import {
  subagentProfileDraftSchema,
  subagentProfileSchema,
  subagentProfileScopeSchema,
} from "./subagent-profile.js";

const projectIdSchema = z.string().startsWith("proj_");
const okResultSchema = z.object({ ok: z.literal(true) });
const host = ["workbench_server"] as const;

/** Scope plus project; `projectId` is required when `scope` is `project`. */
const scopedParams = {
  scope: subagentProfileScopeSchema,
  projectId: projectIdSchema.optional(),
};
function requireProjectForProjectScope(
  value: { scope: string; projectId?: string },
  context: z.RefinementCtx,
) {
  if (value.scope === "project" && !value.projectId)
    context.addIssue({
      code: "custom",
      path: ["projectId"],
      message: "projectId is required for project scope",
    });
}

export const subagentProfilesListParamsSchema = z.object({
  projectId: projectIdSchema.optional(),
});
export const subagentProfilesListResultSchema = z.object({
  /** Effective profiles plus shadowed and invalid ones. */
  profiles: z.array(subagentProfileSchema),
});
export const subagentProfilesSaveParamsSchema = z
  .object({
    ...scopedParams,
    profile: subagentProfileDraftSchema,
    /** Set when renaming; the file with this name is replaced. */
    previousName: subagentProfileNameSchema.optional(),
  })
  .superRefine(requireProjectForProjectScope);
export const subagentProfilesSaveResultSchema = z.object({
  profile: subagentProfileSchema,
});
export const subagentProfilesDeleteParamsSchema = z
  .object({ ...scopedParams, name: subagentProfileNameSchema })
  .superRefine(requireProjectForProjectScope);
/** Stored in the user's `config/subagents.json`; overrides the file's `enabled`. */
export const subagentProfilesSetEnabledParamsSchema = z.object({
  name: subagentProfileNameSchema,
  enabled: z.boolean(),
});
export const subagentProfilesTrustParamsSchema = z.object({
  projectId: projectIdSchema,
  name: subagentProfileNameSchema,
  digest: z.string().min(1),
});

export const subagentProfilesOperationDefinitions = [
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
    "subagentProfiles.save",
    subagentProfilesSaveParamsSchema,
    subagentProfilesSaveResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.save",
  ),
  defineOperation(
    "subagentProfiles.delete",
    subagentProfilesDeleteParamsSchema,
    okResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.delete",
  ),
  defineOperation(
    "subagentProfiles.setEnabled",
    subagentProfilesSetEnabledParamsSchema,
    okResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.setEnabled",
  ),
  defineOperation(
    "subagentProfiles.trust",
    subagentProfilesTrustParamsSchema,
    subagentProfilesSaveResultSchema,
    "mutation",
    "none",
    host,
    "operation.subagentProfiles.trust",
  ),
] as const;
