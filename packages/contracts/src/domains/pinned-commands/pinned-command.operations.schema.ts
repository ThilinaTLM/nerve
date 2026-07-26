import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import {
  createPinnedCommandRequestSchema,
  pinnedCommandSchema,
  updatePinnedCommandRequestSchema,
} from "./pinned-command.schema.js";

const okResultSchema = z.object({ ok: z.literal(true) });
const pinnedCommandIdSchema = z.string().startsWith("pin_");
const projectIdSchema = z.string().startsWith("proj_");
const pinnedCommandScopeSchema = z.object({ projectId: projectIdSchema });
const pinnedCommandCreateParamsSchema = z
  .object({ projectId: projectIdSchema })
  .merge(createPinnedCommandRequestSchema);
const pinnedCommandUpdateParamsSchema = z
  .object({ projectId: projectIdSchema, commandId: pinnedCommandIdSchema })
  .merge(updatePinnedCommandRequestSchema);
const pinnedCommandDeleteParamsSchema = z.object({
  projectId: projectIdSchema,
  commandId: pinnedCommandIdSchema,
});
const hostRoles = ["workbench_server"] as const;

export const pinnedCommandsOperationDefinitions = [
  defineOperation(
    "pinnedCommand.list",
    pinnedCommandScopeSchema,
    z.object({ commands: z.array(pinnedCommandSchema) }),
    "read",
    "none",
    hostRoles,
    "operation.pinnedCommand.list",
  ),
  defineOperation(
    "pinnedCommand.create",
    pinnedCommandCreateParamsSchema,
    z.object({ command: pinnedCommandSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.pinnedCommand.create",
  ),
  defineOperation(
    "pinnedCommand.update",
    pinnedCommandUpdateParamsSchema,
    z.object({ command: pinnedCommandSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.pinnedCommand.update",
  ),
  defineOperation(
    "pinnedCommand.delete",
    pinnedCommandDeleteParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    hostRoles,
    "operation.pinnedCommand.delete",
  ),
] as const;
