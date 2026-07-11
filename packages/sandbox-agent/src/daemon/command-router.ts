import {
  operationNameSchema,
  operationParamsSchema,
  type OperationName,
  sandboxConversationSnapshotGetParamsSchema,
  sandboxSnapshotGetParamsSchema,
  sandboxStatusGetParamsSchema,
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

export class SandboxCommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  register(method: OperationName, handler: CommandHandler): void {
    this.handlers.set(method, handler);
  }

  async dispatch(
    method: string,
    params: unknown,
    context: CommandContext = {},
  ): Promise<unknown> {
    const operation = operationNameSchema.safeParse(method);
    if (!operation.success)
      throw new SandboxCommandError(
        "VALIDATION_FAILED",
        `Unknown sandbox operation: ${method}`,
      );
    const projectionSchema =
      operation.data === "sandbox.status.get"
        ? sandboxStatusGetParamsSchema
        : operation.data === "sandbox.snapshot.get"
          ? sandboxSnapshotGetParamsSchema
          : operation.data === "sandbox.conversation.snapshot.get"
            ? sandboxConversationSnapshotGetParamsSchema
            : undefined;
    const parsed = (
      projectionSchema ?? operationParamsSchema(operation.data)
    ).parse(params);
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
