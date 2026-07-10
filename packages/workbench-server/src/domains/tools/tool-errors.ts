import type { ToolCallErrorDetails } from "@nervekit/contracts";

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
  if (isToolExecutionErrorLike(error)) {
    const details: ToolCallErrorDetails = {
      code: error.code,
      message: error.message,
    };
    if (error.retryable === true) details.retryable = true;
    if (error.details && Object.keys(error.details).length > 0) {
      details.details = error.details;
    }
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

function isToolExecutionErrorLike(error: unknown): error is Error & {
  code: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
} {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & Record<string, unknown>;
  return (
    candidate.name === "ToolExecutionError" &&
    typeof candidate.code === "string" &&
    (candidate.details === undefined ||
      (typeof candidate.details === "object" && candidate.details !== null))
  );
}
