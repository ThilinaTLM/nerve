import {
  operationNameSchema,
  operationParamsSchema,
  type OperationName,
  type SandboxCommandMethod,
  sandboxCommandParamsByMethod,
} from "@nervekit/contracts";
import { SandboxCommandError } from "./errors.js";

export interface CommandContext {
  readonly idempotencyKey?: string;
  readonly requestId?: string;
  readonly requestedMethod?: string;
}

export type CommandHandler = (
  params: unknown,
  context: CommandContext,
) => Promise<unknown> | unknown;

/**
 * Host operation adapter for the sandbox daemon. Canonical catalog operations
 * use the shared operation schemas. The small sandbox command map remains only
 * for manager-owned runtime status/snapshot requests while those projections
 * are served by the agent connection.
 */
function isAgentProjectionMethod(method: string): boolean {
  return (
    method === "sandbox.status.get" ||
    method === "sandbox.snapshot.get" ||
    method === "sandbox.conversation.snapshot.get"
  );
}

export class SandboxCommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  register(
    method: OperationName | SandboxCommandMethod,
    handler: CommandHandler,
  ): void {
    this.handlers.set(method, handler);
  }

  async dispatch(
    method: string,
    params: unknown,
    context: CommandContext = {},
  ): Promise<unknown> {
    const internalSchema = isAgentProjectionMethod(method)
      ? sandboxCommandParamsByMethod[method as SandboxCommandMethod]
      : undefined;
    const operation = operationNameSchema.safeParse(method);
    const schema =
      internalSchema ??
      (operation.success
        ? operationParamsSchema(operation.data)
        : sandboxCommandParamsByMethod[method as SandboxCommandMethod]);
    if (!schema)
      throw new SandboxCommandError(
        "VALIDATION_FAILED",
        `Unknown sandbox operation: ${method}`,
      );
    const parsed = schema.parse(params);
    const handler = this.handlers.get(method);
    if (!handler)
      throw new SandboxCommandError(
        "UNAVAILABLE",
        `No handler registered for ${method}`,
      );
    return handler(parsed, {
      ...context,
      requestedMethod: context.requestedMethod ?? method,
    });
  }
}
