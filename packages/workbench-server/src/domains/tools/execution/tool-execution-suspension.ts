export class ToolExecutionSuspended extends Error {
  constructor() {
    super("Tool execution suspended waiting for user input.");
  }
}

export function isToolExecutionSuspended(
  error: unknown,
): error is ToolExecutionSuspended {
  return error instanceof ToolExecutionSuspended;
}
