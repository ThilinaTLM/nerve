import {
  capabilityConfigurationSchema,
  capabilityOriginSchema,
  capabilityOverridesDocumentSchema,
  capabilityPatchSchema,
  capabilityTrustSchema,
} from "../capabilities/capabilities.js";
import { maintenanceStartResponseSchema } from "../maintenance/maintenance.js";
import {
  createProjectRequestSchema,
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  openProjectInTerminalRequestSchema,
  openProjectInTerminalResponseSchema,
  projectRecordSchema,
  projectPermissionsSchema,
  pruneProjectConversationsRequestSchema,
} from "./project.js";
import { z } from "zod";
import {
  permissionOverlayOriginSchema,
  permissionOverlaySchema,
  permissionPolicyConfigurationSchema,
  projectPermissionTrustSchema,
} from "../permissions/permission-rule-sets.js";
import { defineOperation } from "../../operations/definition.js";
import { policyFallbackDecisionSchema } from "../permissions/unified-policy.js";

const emptyParamsSchema = z.object({}).optional();
const projectIdSchema = z.string().startsWith("proj_");
const projectIdParamsSchema = z.object({ projectId: projectIdSchema });
const projectOpenEditorParamsSchema = projectIdParamsSchema.merge(
  openProjectInEditorRequestSchema,
);
const projectOpenTerminalParamsSchema = projectIdParamsSchema.merge(
  openProjectInTerminalRequestSchema,
);
const projectPruneConversationsParamsSchema = z.intersection(
  projectIdParamsSchema,
  pruneProjectConversationsRequestSchema,
);

export const projectsOperationDefinitions = [
  defineOperation(
    "project.create",
    createProjectRequestSchema,
    z.object({ project: projectRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.create",
  ),
  defineOperation(
    "project.list",
    emptyParamsSchema,
    z.object({ projects: z.array(projectRecordSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.list",
  ),
  defineOperation(
    "project.get",
    projectIdParamsSchema,
    z.object({ project: projectRecordSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.get",
  ),
  defineOperation(
    "project.permissions.get",
    projectIdParamsSchema,
    z.object({ permissions: projectPermissionsSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.permissions.get",
  ),
  defineOperation(
    "project.permissions.update",
    projectIdParamsSchema.extend({
      permissions: projectPermissionsSchema,
    }),
    z.object({ permissions: projectPermissionsSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.permissions.update",
  ),
  defineOperation(
    "project.permissionPolicy.get",
    projectIdParamsSchema.extend({
      conversationId: z.string().startsWith("conv_").optional(),
    }),
    z.object({ configuration: permissionPolicyConfigurationSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.permissionPolicy.get",
  ),
  defineOperation(
    "project.permissionOverlay.update",
    projectIdParamsSchema.extend({
      conversationId: z.string().startsWith("conv_").optional(),
      origin: permissionOverlayOriginSchema,
      overlay: permissionOverlaySchema,
    }),
    z.object({ overlay: permissionOverlaySchema }),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.permissionOverlay.update",
  ),
  defineOperation(
    "project.permissionOverlay.reset",
    projectIdParamsSchema.extend({
      conversationId: z.string().startsWith("conv_").optional(),
      origin: permissionOverlayOriginSchema,
      expectedDocumentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      diagnosticId: z.string().startsWith("policy_diagnostic_").optional(),
      commandId: z.string().min(1).max(256).optional(),
      quarantine: z.boolean().default(true),
    }),
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("reset"),
        documentIdentity: z.string(),
        quarantineIdentity: z.string().optional(),
      }),
      z.object({
        kind: z.literal("external_conflict"),
        currentDocumentDigest: z.string().optional(),
      }),
      z.object({
        kind: z.literal("quarantine_created_reset_not_written"),
        quarantineIdentity: z.string(),
        errorMessage: z.string(),
      }),
      z.object({
        kind: z.literal("reset_written_reload_failed"),
        documentIdentity: z.string(),
        quarantineIdentity: z.string().optional(),
        errorMessage: z.string(),
      }),
      z.object({
        kind: z.literal("trust_failed"),
        documentIdentity: z.string(),
        quarantineIdentity: z.string().optional(),
        errorMessage: z.string(),
      }),
    ]),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.permissionOverlay.reset",
  ),
  defineOperation(
    "project.permissionFallback.selectBaseline",
    projectIdParamsSchema.extend({
      agentId: z.string().startsWith("agent_"),
      diagnosticId: z.string().startsWith("policy_diagnostic_"),
      commandId: z.string().min(1).max(256),
    }),
    z.object({ decision: policyFallbackDecisionSchema }),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.permissionFallback.selectBaseline",
  ),
  defineOperation(
    "project.permissionTrust.update",
    projectIdParamsSchema.extend({ trusted: z.boolean() }),
    z.object({ trust: projectPermissionTrustSchema }),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.permissionTrust.update",
  ),
  defineOperation(
    "project.capabilities.get",
    projectIdParamsSchema.extend({
      conversationId: z.string().startsWith("conv_").optional(),
    }),
    z.object({ configuration: capabilityConfigurationSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.capabilities.get",
  ),
  defineOperation(
    "project.capabilities.update",
    projectIdParamsSchema
      .extend({
        conversationId: z.string().startsWith("conv_").optional(),
        origin: capabilityOriginSchema,
        patch: capabilityPatchSchema.optional(),
        replace: capabilityOverridesDocumentSchema.optional(),
        expectedDigest: z.string().optional(),
      })
      .refine(
        (value) => value.patch !== undefined || value.replace !== undefined,
        {
          message: "A capability patch or replacement is required.",
        },
      ),
    z.object({ configuration: capabilityConfigurationSchema }),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.capabilities.update",
  ),
  defineOperation(
    "project.capabilityTrust.update",
    projectIdParamsSchema.extend({
      trusted: z.boolean(),
      expectedDigest: z.string().optional(),
    }),
    z.object({ trust: capabilityTrustSchema }),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.capabilityTrust.update",
  ),
  defineOperation(
    "project.openEditor",
    projectOpenEditorParamsSchema,
    openProjectInEditorResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.openEditor",
  ),
  defineOperation(
    "project.openTerminal",
    projectOpenTerminalParamsSchema,
    openProjectInTerminalResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.openTerminal",
  ),
  defineOperation(
    "project.conversations.prune",
    projectPruneConversationsParamsSchema,
    maintenanceStartResponseSchema,
    "accepted_async",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.conversations.prune",
  ),
  defineOperation(
    "project.delete",
    projectIdParamsSchema,
    maintenanceStartResponseSchema,
    "accepted_async",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.delete",
  ),
] as const;
