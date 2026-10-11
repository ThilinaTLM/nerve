import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  createLaunchDefinitionRequestSchema,
  launchDefinitionSchema,
  updateLaunchDefinitionRequestSchema,
} from "./launch-definition.js";

const definitionIdSchema = z.string().startsWith("launchdef_");
const scopeParamsSchema = z.object({
  projectId: z.string().startsWith("proj_"),
});
const createParamsSchema = scopeParamsSchema.merge(
  createLaunchDefinitionRequestSchema,
);
const updateParamsSchema = z
  .object({
    projectId: z.string().startsWith("proj_"),
    definitionId: definitionIdSchema,
  })
  .merge(updateLaunchDefinitionRequestSchema);
const deleteParamsSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  definitionId: definitionIdSchema,
});
const hostRoles = ["workbench_server"] as const;

export const launchDefinitionOperationDefinitions = [
  defineOperation(
    "launchDefinition.list",
    scopeParamsSchema,
    z.object({ definitions: z.array(launchDefinitionSchema) }),
    "read",
    "none",
    hostRoles,
    "operation.launchDefinition.list",
  ),
  defineOperation(
    "launchDefinition.create",
    createParamsSchema,
    z.object({ definition: launchDefinitionSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchDefinition.create",
  ),
  defineOperation(
    "launchDefinition.update",
    updateParamsSchema,
    z.object({ definition: launchDefinitionSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchDefinition.update",
  ),
  defineOperation(
    "launchDefinition.delete",
    deleteParamsSchema,
    z.object({ ok: z.literal(true) }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchDefinition.delete",
  ),
] as const;
