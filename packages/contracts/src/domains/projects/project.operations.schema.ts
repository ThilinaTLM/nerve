import {
  createProjectRequestSchema,
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  openProjectInTerminalRequestSchema,
  openProjectInTerminalResponseSchema,
  projectRecordSchema,
  projectSupervisionPreferencesSchema,
  pruneProjectConversationsRequestSchema,
  pruneProjectConversationsResponseSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

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
    z.object({ permissions: projectSupervisionPreferencesSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.project.permissions.get",
  ),
  defineOperation(
    "project.permissions.update",
    projectIdParamsSchema.extend({
      permissions: projectSupervisionPreferencesSchema,
    }),
    z.object({ permissions: projectSupervisionPreferencesSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.project.permissions.update",
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
