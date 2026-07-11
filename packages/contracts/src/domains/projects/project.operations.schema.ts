import {
  createProjectRequestSchema,
  openProjectInEditorRequestSchema,
  openProjectInEditorResponseSchema,
  projectRecordSchema,
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
    ["workbench_server", "sandbox_agent"] as const,
    "operation.project.create",
  ),
  defineOperation(
    "project.list",
    emptyParamsSchema,
    z.object({ projects: z.array(projectRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.project.list",
  ),
  defineOperation(
    "project.get",
    projectIdParamsSchema,
    z.object({ project: projectRecordSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.project.get",
  ),
  defineOperation(
    "project.openEditor",
    projectOpenEditorParamsSchema,
    openProjectInEditorResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.project.openEditor",
  ),
  defineOperation(
    "project.conversations.prune",
    projectPruneConversationsParamsSchema,
    pruneProjectConversationsResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.project.conversations.prune",
  ),
  defineOperation(
    "project.delete",
    projectIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.project.delete",
  ),
] as const;
