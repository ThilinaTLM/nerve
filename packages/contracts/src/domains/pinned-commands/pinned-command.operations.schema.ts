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
const sandboxIdSchema = z.string().min(1);
const pinnedCommandScopeSchema = z.union([
  z.object({ projectId: projectIdSchema }),
  z.object({ sandboxId: sandboxIdSchema }),
]);
const pinnedCommandCreateParamsSchema = z.union([
  z
    .object({ projectId: projectIdSchema })
    .merge(createPinnedCommandRequestSchema),
  z
    .object({ sandboxId: sandboxIdSchema })
    .merge(createPinnedCommandRequestSchema),
]);
const pinnedCommandUpdateParamsSchema = z.union([
  z
    .object({ projectId: projectIdSchema, commandId: pinnedCommandIdSchema })
    .merge(updatePinnedCommandRequestSchema),
  z
    .object({ sandboxId: sandboxIdSchema, commandId: pinnedCommandIdSchema })
    .merge(updatePinnedCommandRequestSchema),
]);
const pinnedCommandDeleteParamsSchema = z.union([
  z.object({ projectId: projectIdSchema, commandId: pinnedCommandIdSchema }),
  z.object({ sandboxId: sandboxIdSchema, commandId: pinnedCommandIdSchema }),
]);
const sandboxPinnedCommandSchema = z.object({
  id: pinnedCommandIdSchema,
  sandboxId: sandboxIdSchema,
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const pinnedCommandResultSchema = z.union([
  pinnedCommandSchema,
  sandboxPinnedCommandSchema,
]);
const hostRoles = [
  "workbench_server",
  "sandbox_agent",
  "sandbox_manager",
] as const;

export const pinnedCommandsOperationDefinitions = [
  defineOperation(
    "pinnedCommand.list",
    pinnedCommandScopeSchema,
    z.object({ commands: z.array(pinnedCommandResultSchema) }),
    "read",
    "none",
    hostRoles,
    "operation.pinnedCommand.list",
  ),
  defineOperation(
    "pinnedCommand.create",
    pinnedCommandCreateParamsSchema,
    z.object({ command: pinnedCommandResultSchema }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.pinnedCommand.create",
  ),
  defineOperation(
    "pinnedCommand.update",
    pinnedCommandUpdateParamsSchema,
    z.object({ command: pinnedCommandResultSchema }),
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
