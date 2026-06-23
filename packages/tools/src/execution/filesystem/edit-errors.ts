import { ToolExecutionError } from "../common/tool-error.js";

export function argumentError(
  message: string,
  details: Record<string, unknown> = {},
): ToolExecutionError {
  return editError("EDIT_ARGUMENT_INVALID", message, details, true);
}

export function editError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  retryable = false,
): ToolExecutionError {
  return new ToolExecutionError(code, message, details, retryable);
}
