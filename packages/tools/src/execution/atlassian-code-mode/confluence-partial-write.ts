import { ToolExecutionError } from "../errors/tool-error.js";

/**
 * Confluence writes are several requests, not one transaction. When a later
 * step fails, the error keeps its code (a 401 still ends the script) and says
 * what already happened, so the script does not blindly repeat it.
 */
export function partialWriteFailure(error: unknown, done: string): Error {
  const reason = error instanceof Error ? error.message : String(error);
  const message = `${reason} (${done})`;
  return error instanceof ToolExecutionError
    ? new ToolExecutionError(error.code, message, error.details)
    : new Error(message, { cause: error });
}
