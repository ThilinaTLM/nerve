import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import {
  createTaskDefinitionRequestSchema,
  taskDefinitionSchema,
  updateTaskDefinitionRequestSchema,
} from "./task-definition.schema.js";

const definitionIdSchema = z.string().startsWith("taskdef_");
const scopeParamsSchema = z.object({
  projectId: z.string().startsWith("proj_"),
});
const createParamsSchema = scopeParamsSchema.merge(
  createTaskDefinitionRequestSchema,
);
const updateParamsSchema = z
  .object({
    projectId: z.string().startsWith("proj_"),
    definitionId: definitionIdSchema,
  })
  .merge(updateTaskDefinitionRequestSchema);
const deleteParamsSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  definitionId: definitionIdSchema,
});
const hostRoles = ["workbench_server"] as const;

export const taskDefinitionOperationDefinitions = [
  defineOperation(
    "taskDefinition.list",
    scopeParamsSchema,
    z.object({ definitions: z.array(taskDefinitionSchema) }),
    "read",
    "none",
    hostRoles,
    "operation.taskDefinition.list",
  ),
  defineOperation(
    "taskDefinition.create",
    createParamsSchema,
    z.object({ definition: taskDefinitionSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.taskDefinition.create",
  ),
  defineOperation(
    "taskDefinition.update",
    updateParamsSchema,
    z.object({ definition: taskDefinitionSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.taskDefinition.update",
  ),
  defineOperation(
    "taskDefinition.delete",
    deleteParamsSchema,
    z.object({ ok: z.literal(true) }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.taskDefinition.delete",
  ),
] as const;
