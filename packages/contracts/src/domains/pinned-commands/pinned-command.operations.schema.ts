import {
  createPinnedCommandRequestSchema,
  pinnedCommandSchema,
  updatePinnedCommandRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const okResultSchema = z.object({ ok: z.literal(true) });
const pinnedCommandIdSchema = z.string().startsWith("pin_");
const projectIdSchema = z.string().startsWith("proj_");
const projectIdParamsSchema = z.object({ projectId: projectIdSchema });
const pinnedCommandListParamsSchema = projectIdParamsSchema;
const pinnedCommandCreateParamsSchema = projectIdParamsSchema.merge(
  createPinnedCommandRequestSchema,
);
const pinnedCommandUpdateParamsSchema = projectIdParamsSchema
  .extend({ commandId: pinnedCommandIdSchema })
  .merge(updatePinnedCommandRequestSchema);
const pinnedCommandDeleteParamsSchema = projectIdParamsSchema.extend({
  commandId: pinnedCommandIdSchema,
});

export const pinnedCommandsOperationDefinitions = [
  defineOperation(
    "pinnedCommand.list",
    pinnedCommandListParamsSchema,
    z.object({ commands: z.array(pinnedCommandSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.pinnedCommand.list",
  ),
  defineOperation(
    "pinnedCommand.create",
    pinnedCommandCreateParamsSchema,
    z.object({ command: pinnedCommandSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.pinnedCommand.create",
  ),
  defineOperation(
    "pinnedCommand.update",
    pinnedCommandUpdateParamsSchema,
    z.object({ command: pinnedCommandSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.pinnedCommand.update",
  ),
  defineOperation(
    "pinnedCommand.delete",
    pinnedCommandDeleteParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.pinnedCommand.delete",
  ),
] as const;
