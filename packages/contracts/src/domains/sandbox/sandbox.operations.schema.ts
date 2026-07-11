import {
  sandboxAgentConfigureParamsSchema,
  sandboxAgentConfigureResultSchema,
  sandboxConversationSnapshotGetParamsSchema,
  sandboxConversationViewSnapshotSchema,
  sandboxPinnedCommandCreateParamsSchema,
  sandboxPinnedCommandDeleteParamsSchema,
  sandboxPinnedCommandListParamsSchema,
  sandboxPinnedCommandSchema,
  sandboxPinnedCommandUpdateParamsSchema,
  sandboxRunCancelParamsSchema,
  sandboxRunCancelResultSchema,
  sandboxRunContinueParamsSchema,
  sandboxRunContinueResultSchema,
  sandboxRunStartParamsSchema,
  sandboxRunStartResultSchema,
  sandboxSnapshotGetParamsSchema,
  sandboxSnapshotResultSchema,
  sandboxToolCallGetParamsSchema,
  sandboxToolCallGetResultSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const okResultSchema = z.object({ ok: z.literal(true) });
const sandboxIdParamsSchema = z.object({ sandboxId: z.string().min(1) });
const sandboxSnapshotProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxSnapshotGetParamsSchema,
);
const sandboxConversationSnapshotProtocolParamsSchema =
  sandboxIdParamsSchema.merge(
    sandboxConversationSnapshotGetParamsSchema.omit({ sandboxId: true }),
  );
const sandboxRunStartProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxRunStartParamsSchema,
);
const sandboxRunCancelProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxRunCancelParamsSchema,
);
const sandboxRunContinueProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxRunContinueParamsSchema,
);
const sandboxAgentConfigureProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxAgentConfigureParamsSchema.omit({ sandboxId: true }),
);
const sandboxToolCallGetProtocolParamsSchema = sandboxIdParamsSchema.merge(
  sandboxToolCallGetParamsSchema.omit({ sandboxId: true }),
);

export const sandboxOperationDefinitions = [
  defineOperation(
    "sandbox.snapshot.get",
    sandboxSnapshotProtocolParamsSchema,
    sandboxSnapshotResultSchema,
    "read",
    "none",
    ["sandbox_manager"] as const,
    "operation.sandbox.snapshot.get",
  ),
  defineOperation(
    "sandbox.conversation.snapshot.get",
    sandboxConversationSnapshotProtocolParamsSchema,
    sandboxConversationViewSnapshotSchema,
    "read",
    "none",
    ["sandbox_manager"] as const,
    "operation.sandbox.conversation.snapshot.get",
  ),
  defineOperation(
    "sandbox.agent.prompt",
    sandboxRunStartProtocolParamsSchema,
    sandboxRunStartResultSchema,
    "accepted_async",
    "required",
    ["sandbox_manager"] as const,
    "operation.sandbox.agent.prompt",
  ),
  defineOperation(
    "sandbox.agent.abort",
    sandboxRunCancelProtocolParamsSchema,
    sandboxRunCancelResultSchema,
    "mutation",
    "required",
    ["sandbox_manager"] as const,
    "operation.sandbox.agent.abort",
  ),
  defineOperation(
    "sandbox.agent.continue",
    sandboxRunContinueProtocolParamsSchema,
    sandboxRunContinueResultSchema,
    "accepted_async",
    "required",
    ["sandbox_manager"] as const,
    "operation.sandbox.agent.continue",
  ),
  defineOperation(
    "sandbox.agent.configure",
    sandboxAgentConfigureProtocolParamsSchema,
    sandboxAgentConfigureResultSchema,
    "mutation",
    "recommended",
    ["sandbox_manager"] as const,
    "operation.sandbox.agent.configure",
  ),
  defineOperation(
    "sandbox.pinnedCommand.list",
    sandboxPinnedCommandListParamsSchema,
    z.object({ commands: z.array(sandboxPinnedCommandSchema) }),
    "read",
    "none",
    ["sandbox_manager"] as const,
    "operation.sandbox.pinnedCommand.list",
  ),
  defineOperation(
    "sandbox.pinnedCommand.create",
    sandboxPinnedCommandCreateParamsSchema,
    z.object({ command: sandboxPinnedCommandSchema }),
    "mutation",
    "recommended",
    ["sandbox_manager"] as const,
    "operation.sandbox.pinnedCommand.create",
  ),
  defineOperation(
    "sandbox.pinnedCommand.update",
    sandboxPinnedCommandUpdateParamsSchema,
    z.object({ command: sandboxPinnedCommandSchema }),
    "mutation",
    "recommended",
    ["sandbox_manager"] as const,
    "operation.sandbox.pinnedCommand.update",
  ),
  defineOperation(
    "sandbox.pinnedCommand.delete",
    sandboxPinnedCommandDeleteParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["sandbox_manager"] as const,
    "operation.sandbox.pinnedCommand.delete",
  ),
  defineOperation(
    "sandbox.toolCall.get",
    sandboxToolCallGetProtocolParamsSchema,
    sandboxToolCallGetResultSchema,
    "read",
    "none",
    ["sandbox_manager"] as const,
    "operation.sandbox.toolCall.get",
  ),
] as const;
