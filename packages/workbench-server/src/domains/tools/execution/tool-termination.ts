import {
  CANCELLED_TOOL_ERROR_CODE,
  INTERRUPTED_TOOL_ERROR_CODE,
} from "@nervekit/contracts/events";
import { type ToolCallRecord } from "@nervekit/contracts/tools";
import { prepareTerminalProjection } from "../artifacts/tool-result-preparation.js";

export type ToolTerminationOutcome = {
  status: "cancelled" | "failed";
  code: typeof CANCELLED_TOOL_ERROR_CODE | typeof INTERRUPTED_TOOL_ERROR_CODE;
  message: string;
};

export const TOOL_CANCELLED_OUTCOME = {
  status: "cancelled",
  code: CANCELLED_TOOL_ERROR_CODE,
  message: "Tool execution was cancelled.",
} as const satisfies ToolTerminationOutcome;

export const RUN_CANCELLED_TOOL_OUTCOME = {
  ...TOOL_CANCELLED_OUTCOME,
  message: "Tool execution was cancelled because the run was cancelled.",
} as const satisfies ToolTerminationOutcome;

export const CANCELLED_AFTER_CLAIM_MESSAGE =
  "Cancellation was requested after this tool may have started. Its external outcome is unknown; inspect the target before retrying.";

/** A durable claim is evidence of possible dispatch, not proof of an effect. */
export function toolTerminationPatch(
  toolCall: ToolCallRecord,
  outcome: ToolTerminationOutcome,
): Partial<Omit<ToolCallRecord, "id" | "createdAt">> {
  const cancellation = outcome.status === "cancelled";
  const claimed = Boolean(toolCall.execution?.executionId);
  const message = cancellation
    ? claimed
      ? CANCELLED_AFTER_CLAIM_MESSAGE
      : "Tool was cancelled before dispatch; it was not executed."
    : outcome.message;
  const errorDetails = cancellation
    ? claimed
      ? {
          code: "TOOL_OUTCOME_UNKNOWN",
          message,
          details: { phase: "post_dispatch" },
        }
      : {
          code: "TOOL_NOT_DISPATCHED",
          message,
          details: { phase: "pre_dispatch" },
        }
    : { code: outcome.code, message };
  const result = {
    content: message,
    contentBlocks: [{ type: "text" as const, text: message }],
  };
  const projection = prepareTerminalProjection(result, {
    toolName: toolCall.toolName,
    args: toolCall.args,
    status: outcome.status,
    phase: outcome.status,
    error: message,
    errorDetails,
  });
  return {
    status: outcome.status,
    error: message,
    errorDetails,
    result,
    ...projection,
  };
}
