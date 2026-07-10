export class ToolExecutionError extends Error {
  readonly isToolExecutionError = true;

  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
