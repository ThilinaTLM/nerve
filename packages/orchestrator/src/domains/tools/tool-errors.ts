import type { ToolCallErrorDetails } from "@nerve/shared";

export class CodedToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CodedToolError";
  }
}

export function toolErrorDetails(error: unknown): ToolCallErrorDetails {
  if (error instanceof CodedToolError) {
    const details: ToolCallErrorDetails = {
      code: error.code,
      message: error.message,
    };
    if (error.retryable) details.retryable = true;
    if (Object.keys(error.details).length > 0) details.details = error.details;
    return details;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/^Tool argument '\w+'/.test(message)) {
    return {
      code: "TOOL_ARGUMENT_INVALID",
      message,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message,
  };
}
