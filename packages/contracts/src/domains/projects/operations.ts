import {
  createProjectRequestSchema,
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  openProjectInTerminalRequestSchema,
  openProjectInTerminalResponseSchema,
  projectRecordSchema,
  projectPermissionsSchema,
  pruneProjectConversationsRequestSchema,
  pruneProjectConversationsResponseSchema,
} from "./project.js";
import { z } from "zod";
import {
  permissionOverlayOriginSchema,
  permissionOverlaySchema,
  permissionPolicyConfigurationSchema,
  projectPermissionTrustSchema,
} from "../permissions/permission-rule-sets.js";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();
const okResultSchema = z.object({ ok: z.literal(true) });
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
    "project.permissionTrust.update",
    projectIdParamsSchema.extend({ trusted: z.boolean() }),
    z.object({ trust: projectPermissionTrustSchema }),
    "mutation",
    "required",
    ["workbench_server"] as const,
    "operation.project.permissionTrust.update",
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
    pruneProjectConversationsResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.conversations.prune",
  ),
  defineOperation(
    "project.delete",
    projectIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.delete",
  ),
] as const;
