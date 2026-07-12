import {
  operationNameSchema,
  operationParamsSchema,
  operationResultSchema,
  type OperationName,
  sandboxConversationSnapshotGetParamsSchema,
  sandboxConversationViewSnapshotSchema,
  sandboxSnapshotGetParamsSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetParamsSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/contracts";
import { SandboxOperationError } from "./errors.js";

export interface OperationContext {
  readonly idempotencyKey?: string;
  readonly requestId?: string;
  readonly requestedMethod?: string;
}

export type OperationHandler = (
  params: unknown,
  context: OperationContext,
) => Promise<unknown> | unknown;

export class SandboxOperationRouter {
  private readonly handlers = new Map<string, OperationHandler>();

  register(method: OperationName, handler: OperationHandler): void {
    this.handlers.set(method, handler);
  }

  parseParams(method: string, params: unknown): unknown {
    const operation = operationNameSchema.safeParse(method);
    if (!operation.success)
      throw new SandboxOperationError(
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
    return (projectionSchema ?? operationParamsSchema(operation.data)).parse(
      params,
    );
  }

  async dispatch(
    method: string,
    params: unknown,
    context: OperationContext = {},
  ): Promise<unknown> {
    const parsed = this.parseParams(method, params);
    const handler = this.handlers.get(method);
    if (!handler)
      throw new SandboxOperationError(
        "UNAVAILABLE",
        `No handler registered for ${method}`,
      );
    const result = await handler(parsed, {
      ...context,
      requestedMethod: context.requestedMethod ?? method,
    });
    const operation = operationNameSchema.parse(method);
    const projectionSchema =
      operation === "sandbox.status.get"
        ? sandboxStatusGetResultSchema
        : operation === "sandbox.snapshot.get"
          ? sandboxSnapshotResultSchema
          : operation === "sandbox.conversation.snapshot.get"
            ? sandboxConversationViewSnapshotSchema
            : undefined;
    return (projectionSchema ?? operationResultSchema(operation)).parse(result);
  }
}
