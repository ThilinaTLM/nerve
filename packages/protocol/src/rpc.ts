import {
  operationDefinition,
  parseOperationParams,
  parseOperationResult,
  protocolRequestDataSchema,
  type NerveMessage,
  type OperationName,
  type OperationParams,
  type OperationResult,
  type ProtocolErrorData,
  type ProtocolRequestData,
  type ProtocolResponseData,
} from "@nervekit/contracts";
import type { MessageFactory } from "./messages.js";

export class RpcError extends Error {
  constructor(readonly data: ProtocolErrorData) {
    super(data.message);
    this.name = "RpcError";
  }
}

export interface RpcClientOptions {
  readonly createMessage: MessageFactory;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly defaultTimeoutMs?: number;
}

type PendingRequest = {
  readonly method: OperationName;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

export class RpcClient {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #options: RpcClientOptions;

  constructor(options: RpcClientOptions) {
    this.#options = options;
  }

  async request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > = {},
  ): Promise<OperationResult<M>> {
    const operation = operationDefinition(method);
    const validatedParams = parseOperationParams(method, params);
    if (operation.idempotency === "none" && options.idempotencyKey)
      throw new RpcError({
        code: "VALIDATION_FAILED",
        message: `Operation ${method} does not accept an idempotency key`,
        retryable: false,
      });
    if (operation.idempotency === "required" && !options.idempotencyKey)
      throw new RpcError({
        code: "VALIDATION_FAILED",
        message: `Operation ${method} requires an idempotency key`,
        retryable: false,
      });
    const data = protocolRequestDataSchema.parse({
      method,
      params: validatedParams,
      ...options,
    });
    const message = this.#options.createMessage("request", data);
    const timeoutMs =
      data.timeoutMs ?? this.#options.defaultTimeoutMs ?? 30_000;
    const response = new Promise<OperationResult<M>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(message.id);
        reject(
          new RpcError({
            code: "OPERATION_TIMEOUT",
            message: `Operation ${method} timed out`,
            retryable: true,
          }),
        );
      }, timeoutMs);
      this.#pending.set(message.id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
    });
    try {
      await this.#options.send(message);
    } catch (error) {
      this.reject(message.id, error);
    }
    return response;
  }

  handle(message: NerveMessage): boolean {
    if (message.kind !== "response" && message.kind !== "error") return false;
    const requestId = message.replyTo ?? message.correlationId;
    if (!requestId) return false;
    const pending = this.#pending.get(requestId);
    if (!pending) return false;
    this.#pending.delete(requestId);
    clearTimeout(pending.timeout);
    if (message.kind === "error") {
      pending.reject(new RpcError(message.data as ProtocolErrorData));
    } else {
      const response = message.data as ProtocolResponseData;
      if (response.method !== pending.method) {
        pending.reject(
          new RpcError({
            code: "INVALID_MESSAGE",
            message: "RPC response method did not match the request",
            retryable: false,
          }),
        );
        return true;
      }
      try {
        pending.resolve(parseOperationResult(pending.method, response.result));
      } catch {
        pending.reject(
          new RpcError({
            code: "INVALID_MESSAGE",
            message: `Invalid result for ${pending.method}`,
            retryable: false,
          }),
        );
      }
    }
    return true;
  }

  close(error = new Error("RPC client closed")): void {
    for (const id of [...this.#pending.keys()]) this.reject(id, error);
  }

  private reject(id: string, error: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
}

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
    if (request.target.role === "sandbox_agent" && !request.target.id) {
      return failure(
        "VALIDATION_FAILED",
        "Sandbox agent requests require a nonempty target id",
      );
    }
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
