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
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable || undefined,
      details:
        Object.keys(error.details).length > 0 ? error.details : undefined,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}
