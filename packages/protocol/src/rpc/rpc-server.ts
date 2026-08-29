import {
  operationDefinition,
  type OperationName,
  type OperationParams,
  type OperationResult,
} from "@nervekit/contracts/operations";
import {
  protocolRequestDataSchema,
  type NerveMessage,
  type ProtocolErrorData,
  type ProtocolRequestData,
} from "@nervekit/contracts/wire";
export type OperationHandler<M extends OperationName> = (
  params: OperationParams<M>,
  request: NerveMessage<ProtocolRequestData>,
) => OperationResult<M> | Promise<OperationResult<M>>;

export type OperationHandlerRegistry = {
  readonly [M in OperationName]: OperationHandler<M>;
};

export interface RpcDispatcherOptions {
  readonly handlers: Partial<OperationHandlerRegistry>;
  readonly idempotency?: IdempotencyStorePort;
  readonly acceptedCapabilities?: readonly string[] | (() => readonly string[]);
  readonly translateError?: (error: unknown) => ProtocolErrorData;
}

export type IdempotencyOutcome =
  | { readonly status: "success"; readonly result: unknown }
  | { readonly status: "error"; readonly error: ProtocolErrorData };

export interface IdempotencyStorePort {
  execute(
    scope: string,
    key: string,
    method: string,
    params: unknown,
    operation: () => Promise<IdempotencyOutcome>,
  ): Promise<IdempotencyExecution>;
}

export type IdempotencyExecution =
  | {
      readonly status: "executed" | "replayed";
      readonly outcome: IdempotencyOutcome;
    }
  | { readonly status: "conflict" };

export type RpcDispatchResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: ProtocolErrorData };

export class RpcDispatcher {
  constructor(private readonly options: RpcDispatcherOptions) {}

  async dispatch(
    request: NerveMessage<ProtocolRequestData>,
  ): Promise<RpcDispatchResult> {
    const parsedRequest = protocolRequestDataSchema.safeParse(request.data);
    if (!parsedRequest.success)
      return failure("VALIDATION_FAILED", "Invalid request data");
    const { method, params, idempotencyKey } = parsedRequest.data;
    const operation = operationDefinition(method);
    if (
      operation.allowedTargetRoles &&
      !operation.allowedTargetRoles.includes(request.target.role)
    ) {
      return failure(
        "AUTH_FORBIDDEN",
        `Operation ${method} cannot target ${request.target.role}`,
      );
    }
    if (
      operation.requiredCapability &&
      this.options.acceptedCapabilities &&
      !(
        typeof this.options.acceptedCapabilities === "function"
          ? this.options.acceptedCapabilities()
          : this.options.acceptedCapabilities
      ).includes(operation.requiredCapability)
    ) {
      return failure(
        "CAPABILITY_REQUIRED",
        `Operation ${method} requires capability ${operation.requiredCapability}`,
      );
    }
    if (operation.idempotency === "none" && idempotencyKey) {
      return failure(
        "VALIDATION_FAILED",
        `Operation ${method} does not accept an idempotency key`,
      );
    }
    if (operation.idempotency === "required" && !idempotencyKey) {
      return failure(
        "VALIDATION_FAILED",
        `Operation ${method} requires an idempotency key`,
      );
    }
    let validatedParams: unknown;
    try {
      validatedParams = operation.paramsSchema.parse(params);
    } catch {
      return failure(
        "DOMAIN_VALIDATION_FAILED",
        `Invalid parameters for ${method}`,
      );
    }

    const invoke = async (): Promise<IdempotencyOutcome> => {
      try {
        const handler = this.options.handlers[method] as
          | OperationHandler<typeof method>
          | undefined;
        if (!handler)
          return {
            status: "error",
            error: {
              code: "METHOD_NOT_FOUND",
              message: `No handler registered for ${method}`,
              retryable: false,
            },
          };
        const rawResult = await handler(
          validatedParams as OperationParams<typeof method>,
          request,
        );
        return {
          status: "success",
          result: operation.resultSchema.parse(rawResult),
        };
      } catch (error) {
        return {
          status: "error",
          error: this.options.translateError?.(error) ?? {
            code: "INTERNAL_ERROR",
            message:
              error instanceof Error ? error.message : "Operation failed",
            retryable: true,
          },
        };
      }
    };
    let outcome: IdempotencyOutcome;
    if (idempotencyKey && this.options.idempotency) {
      const scope = `${request.source.role}:${request.source.id ?? request.source.instanceId ?? "anonymous"}`;
      const execution = await this.options.idempotency.execute(
        scope,
        idempotencyKey,
        method,
        validatedParams,
        invoke,
      );
      if (execution.status === "conflict") {
        return failure(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for different parameters",
        );
      }
      outcome = execution.outcome;
    } else {
      outcome = await invoke();
    }
    return outcome.status === "success"
      ? { ok: true, result: outcome.result }
      : { ok: false, error: outcome.error };
  }
}

function failure(
  code: ProtocolErrorData["code"],
  message: string,
  retryable = false,
): RpcDispatchResult {
  return { ok: false, error: { code, message, retryable } };
}
