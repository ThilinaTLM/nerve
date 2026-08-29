import {
  CANCELLED_TOOL_ERROR_CODE,
  INTERRUPTED_TOOL_ERROR_CODE,
  type ToolCallRecord,
} from "@nervekit/contracts";
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

export function toolTerminationPatch(
  toolCall: ToolCallRecord,
  outcome: ToolTerminationOutcome,
): Partial<Omit<ToolCallRecord, "id" | "createdAt">> {
  const errorDetails = {
    code: outcome.code,
    message: outcome.message,
  };
  const result = {
    content: outcome.message,
    contentBlocks: [{ type: "text" as const, text: outcome.message }],
  };
  const projection = prepareTerminalProjection(result, {
    toolName: toolCall.toolName,
    args: toolCall.args,
    status: outcome.status,
    phase: outcome.status,
    error: outcome.message,
    errorDetails,
  });
  return {
    status: outcome.status,
    error: outcome.message,
    errorDetails,
    result,
    ...projection,
  };
}
