import type { ToolCallTranscriptRecord } from "../../state/tool-types";

type ToolFailureRecord = Pick<
  ToolCallTranscriptRecord,
  "status" | "errorDetails"
>;

const INPUT_VALIDATION_ERROR_CODES = new Set([
  "INVALID_TOOL_ARGUMENTS",
  "TOOL_ARGUMENT_INVALID",
]);

/** Whether the call was rejected before a meaningful execution could begin. */
export function isInputValidationFailure(toolCall: ToolFailureRecord): boolean {
  if (toolCall.status !== "error") return false;

  const code = toolCall.errorDetails?.code.toUpperCase();
  if (!code) return false;

  return (
    INPUT_VALIDATION_ERROR_CODES.has(code) || code.endsWith("_ARGUMENT_INVALID")
  );
}
