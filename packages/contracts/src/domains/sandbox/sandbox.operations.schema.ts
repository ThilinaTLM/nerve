import { z } from "zod";
import { streamCursorSchema } from "../protocol/event-stream.schema.js";
import { defineOperation } from "../protocol/operation-definition.schema.js";
import {
  logReadOptionsSchema,
  managedSandboxListItemSchema,
  managedSandboxRecordSchema,
  removeOptionsSchema,
  sandboxConfigYamlResultSchema,
  sandboxContainerLogsResultSchema,
  sandboxCreateRequestSchema,
  sandboxRuntimeContainerStatusSchema,
  stopOptionsSchema,
} from "./sandbox.manager.schema.js";
import {
  sandboxConversationSnapshotGetParamsSchema,
  sandboxConversationViewSnapshotSchema,
} from "./sandbox.conversation-snapshot.schema.js";
import {
  sandboxSnapshotGetParamsSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "./sandbox.snapshot.schema.js";

const sandboxIdSchema = z.string().min(1);
const sandboxIdParamsSchema = z.object({ sandboxId: sandboxIdSchema });
const sandboxSnapshotProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxSnapshotGetParamsSchema,
);
const sandboxConversationSnapshotProtocolParamsSchema =
  sandboxIdParamsSchema.merge(
    sandboxConversationSnapshotGetParamsSchema.omit({ sandboxId: true }),
  );
const sandboxStopParamsSchema = sandboxIdParamsSchema.merge(stopOptionsSchema);
const sandboxRemoveParamsSchema =
  sandboxIdParamsSchema.merge(removeOptionsSchema);
const sandboxLogsParamsSchema =
  sandboxIdParamsSchema.merge(logReadOptionsSchema);
const managerRole = ["sandbox_manager"] as const;
const managerRecoveryParamsSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  conversationId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
});
const managerRecoveryResultSchema = z.object({
  stateEpoch: z.literal("protocol-v1"),
  cursors: z.array(streamCursorSchema),
  sandboxes: z.array(managedSandboxListItemSchema),
  selectedSandbox: sandboxSnapshotResultSchema.optional(),
  selectedConversation: sandboxConversationViewSnapshotSchema.optional(),
});

export const sandboxOperationDefinitions = [
  defineOperation(
    "sandbox.manager.recovery.get",
    managerRecoveryParamsSchema,
    managerRecoveryResultSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.manager.recovery.get",
  ),
  defineOperation(
    "sandbox.create",
    sandboxCreateRequestSchema,
    z.object({ sandbox: managedSandboxRecordSchema }),
    "accepted_async",
    "required",
    managerRole,
    "operation.sandbox.create",
  ),
  defineOperation(
    "sandbox.list",
    z.object({}).optional(),
    z.object({ sandboxes: z.array(managedSandboxListItemSchema) }),
    "read",
    "none",
    managerRole,
    "operation.sandbox.list",
  ),
  defineOperation(
    "sandbox.get",
    sandboxIdParamsSchema,
    z.object({ sandbox: managedSandboxRecordSchema }),
    "read",
    "none",
    managerRole,
    "operation.sandbox.get",
  ),
  defineOperation(
    "sandbox.start",
    sandboxIdParamsSchema,
    z.object({ sandbox: managedSandboxRecordSchema }),
    "accepted_async",
    "required",
    managerRole,
    "operation.sandbox.start",
  ),
  defineOperation(
    "sandbox.stop",
    sandboxStopParamsSchema,
    z.object({ sandbox: managedSandboxRecordSchema }),
    "accepted_async",
    "required",
    managerRole,
    "operation.sandbox.stop",
  ),
  defineOperation(
    "sandbox.restart",
    sandboxStopParamsSchema,
    z.object({ sandbox: managedSandboxRecordSchema }),
    "accepted_async",
    "required",
    managerRole,
    "operation.sandbox.restart",
  ),
  defineOperation(
    "sandbox.remove",
    sandboxRemoveParamsSchema,
    z.object({ sandbox: managedSandboxRecordSchema }),
    "mutation",
    "required",
    managerRole,
    "operation.sandbox.remove",
  ),
  defineOperation(
    "sandbox.config.get",
    sandboxIdParamsSchema,
    sandboxConfigYamlResultSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.config.get",
  ),
  defineOperation(
    "sandbox.status.get",
    sandboxIdParamsSchema,
    sandboxStatusGetResultSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.status.get",
  ),
  defineOperation(
    "sandbox.container.status.get",
    sandboxIdParamsSchema,
    sandboxRuntimeContainerStatusSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.container.status.get",
  ),
  defineOperation(
    "sandbox.container.logs.get",
    sandboxLogsParamsSchema,
    sandboxContainerLogsResultSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.container.logs.get",
  ),
  defineOperation(
    "sandbox.snapshot.get",
    sandboxSnapshotProtocolParamsSchema,
    sandboxSnapshotResultSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.snapshot.get",
  ),
  defineOperation(
    "sandbox.conversation.snapshot.get",
    sandboxConversationSnapshotProtocolParamsSchema,
    sandboxConversationViewSnapshotSchema,
    "read",
    "none",
    managerRole,
    "operation.sandbox.conversation.snapshot.get",
  ),
] as const;
