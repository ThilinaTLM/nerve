import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { INTERRUPTED_TOOL_ERROR_CODE } from "@nervekit/contracts/events";
import { toolTerminationPatch } from "./tool-termination.js";
const HOST_RESTART_TOOL_ERROR =
  "Tool execution was interrupted because the host restarted.";

/** Replay updates serially, publishing only after each durable update succeeds. */
export async function reconcileInterruptedToolCalls(
  records: readonly ToolCallRecord[],
  update: (
    id: string,
    patch: Partial<ToolCallRecord>,
  ) => Promise<ToolCallRecord>,
  publish: (record: ToolCallRecord) => Promise<void>,
): Promise<void> {
  const interrupted = records.filter(
    (toolCall) =>
      (toolCall.status === "committed" || toolCall.status === "running") &&
      !isOwnedByApprovalExecution(toolCall),
  );
  for (const toolCall of interrupted) {
    const failed = await update(
      toolCall.id,
      toolTerminationPatch(toolCall, {
        status: "failed",
        code: INTERRUPTED_TOOL_ERROR_CODE,
        message: HOST_RESTART_TOOL_ERROR,
      }),
    );
    await publish(failed);
  }
}

/**
 * A user-approved tool is executed by durable lifecycle work, not by the live
 * model turn. Restart recovery reconciles it from that work: an undispatched
 * `committed` claim runs once, and a possibly dispatched `running` claim is
 * classified without being failed as if its outcome were known.
 */
function isOwnedByApprovalExecution(toolCall: ToolCallRecord): boolean {
  return toolCall.interactions.some(
    (interaction) =>
      interaction.kind === "approval" &&
      interaction.status === "resolved" &&
      interaction.resolution?.action === "allow",
  );
}
