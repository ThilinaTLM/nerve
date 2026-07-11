import {
  operationDefinition,
  protocolRequestDataSchema,
  type NerveMessage,
  type OperationName,
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
  readonly operation?: (
    method: OperationName,
  ) => RpcOperationDefinition | undefined;
}

type PendingRequest = {
  readonly method: OperationName;
  readonly resultSchema?: RpcOperationDefinition["resultSchema"];
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

  async request<TResult = unknown>(
    method: OperationName,
    params?: unknown,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > = {},
  ): Promise<TResult> {
    const operation =
      this.#options.operation?.(method) ?? operationDefinition(method);
    const validatedParams = operation.paramsSchema.parse(params);
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
    const response = new Promise<TResult>((resolve, reject) => {
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
        resultSchema: operation.resultSchema,
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
        pending.resolve(
          pending.resultSchema?.parse(response.result) ?? response.result,
        );
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

export interface RpcOperationDefinition {
  readonly paramsSchema: { parse(input: unknown): unknown };
  readonly resultSchema: { parse(input: unknown): unknown };
  readonly idempotency: "none" | "recommended" | "required";
  readonly allowedTargetRoles?: readonly string[];
  readonly requiredCapability?: string;
}

export interface RpcDispatcherOptions {
  readonly operation: (
    method: OperationName,
  ) => RpcOperationDefinition | undefined;
  readonly handle: (
    method: OperationName,
    params: unknown,
    request: NerveMessage<ProtocolRequestData>,
  ) => unknown | Promise<unknown>;
  readonly idempotency?: IdempotencyStorePort;
  readonly acceptedCapabilities?: readonly string[];
}

export interface IdempotencyStorePort {
  lookup(
    scope: string,
    key: string,
    method: string,
    params: unknown,
  ): Promise<IdempotencyLookup> | IdempotencyLookup;
  store(
    scope: string,
    key: string,
    method: string,
    params: unknown,
    result: unknown,
  ): Promise<void> | void;
}

export type IdempotencyLookup =
  | { readonly status: "miss" }
  | { readonly status: "hit"; readonly result: unknown }
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
    const operation = this.options.operation(method);
    if (!operation)
      return failure("METHOD_NOT_FOUND", `Unknown operation: ${method}`);
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
      !this.options.acceptedCapabilities.includes(operation.requiredCapability)
    ) {
      return failure(
        "CAPABILITY_REQUIRED",
        `Operation ${method} requires capability ${operation.requiredCapability}`,
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

    const scope = `${request.source.role}:${request.source.id ?? request.source.instanceId ?? "anonymous"}`;
    if (idempotencyKey && this.options.idempotency) {
      const lookup = await this.options.idempotency.lookup(
        scope,
        idempotencyKey,
        method,
        validatedParams,
      );
      if (lookup.status === "hit") return { ok: true, result: lookup.result };
      if (lookup.status === "conflict") {
        return failure(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for different parameters",
        );
      }
    }

    try {
      const rawResult = await this.options.handle(
        method,
        validatedParams,
        request,
      );
      const result = operation.resultSchema.parse(rawResult);
      if (idempotencyKey && this.options.idempotency) {
        await this.options.idempotency.store(
          scope,
          idempotencyKey,
          method,
          validatedParams,
          result,
        );
      }
      return { ok: true, result };
    } catch (error) {
      return failure(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Operation failed",
        true,
      );
    }
  }
}

function failure(
  code: ProtocolErrorData["code"],
  message: string,
  retryable = false,
): RpcDispatchResult {
  return { ok: false, error: { code, message, retryable } };
}
