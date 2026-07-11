import {
  conversationSnapshotResponseSchema,
  workspaceSnapshotResponseSchema,
} from "../protocol/snapshot.schema.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const conversationIdSchema = z.string().startsWith("conv_");
const conversationIdParamsSchema = z.object({
  conversationId: conversationIdSchema,
});
const conversationSnapshotParamsSchema = conversationIdParamsSchema;

export const snapshotsOperationDefinitions = [
  defineOperation(
    "snapshot.workspace.get",
    emptyParamsSchema,
    workspaceSnapshotResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.snapshot.workspace.get",
  ),
  defineOperation(
    "snapshot.conversation.get",
    conversationSnapshotParamsSchema,
    conversationSnapshotResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.snapshot.conversation.get",
  ),
] as const;
