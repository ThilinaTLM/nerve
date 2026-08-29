import {
  parseOperationResult,
  type NerveMessage,
  type OperationName,
  type OperationParams,
  type OperationResult,
  type ProtocolErrorData,
  type ProtocolRequestData,
  type ProtocolResponseData,
} from "@nervekit/contracts";
import type {
  MessageFactory,
  MessageFactoryOptions,
} from "../messages/message-factory.js";
import type { ProtocolTimers } from "../runtime/ports.js";
import { systemProtocolTimers } from "../runtime/system-runtime.js";
import { prepareOperationRequest } from "./operation-request.js";

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
  readonly timers?: Pick<ProtocolTimers, "setTimeout" | "clearTimeout">;
}

type PendingRequest = {
  readonly method: OperationName;
  readonly message: NerveMessage<ProtocolRequestData>;
  readonly retryable: boolean;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: unknown;
};

export class RpcClient {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #options: RpcClientOptions;
  readonly #timers: Pick<ProtocolTimers, "setTimeout" | "clearTimeout">;

  constructor(options: RpcClientOptions) {
    this.#options = options;
    this.#timers = options.timers ?? systemProtocolTimers;
  }

  async request<M extends OperationName>(
    method: M,
    params: OperationParams<M>,
    options: Pick<
      ProtocolRequestData,
      "idempotencyKey" | "timeoutMs" | "expect"
    > &
      Partial<
        Pick<
          MessageFactoryOptions,
          "correlationId" | "causationId" | "traceId" | "target"
        >
      > = {},
  ): Promise<OperationResult<M>> {
    const { correlationId, causationId, traceId, target, ...requestOptions } =
      options;
    const prepared = prepareOperationRequest(method, params, {
      ...requestOptions,
      target,
    });
    if (!prepared.ok) {
      throw new RpcError({ ...prepared.error, retryable: false });
    }
    const data = prepared.data;
    const message = this.#options.createMessage("request", data, {
      correlationId,
      causationId,
      traceId,
      target,
    });
    const timeoutMs =
      data.timeoutMs ?? this.#options.defaultTimeoutMs ?? 30_000;
    const response = new Promise<OperationResult<M>>((resolve, reject) => {
      const timeout = this.#timers.setTimeout(() => {
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
        message,
        retryable: prepared.retryable,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
    });
    try {
      await this.#options.send(message);
    } catch (error) {
      if (!this.#pending.get(message.id)?.retryable)
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
    this.#timers.clearTimeout(pending.timeout);
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

  disconnect(error = new Error("RPC transport disconnected")): void {
    for (const [id, pending] of this.#pending) {
      if (!pending.retryable) this.reject(id, error);
    }
  }

  async retryPending(): Promise<void> {
    for (const pending of this.#pending.values()) {
      if (!pending.retryable) continue;
      try {
        await this.#options.send(pending.message);
      } catch {
        // Keep idempotent requests pending for a later reconnect until timeout.
      }
    }
  }

  close(error = new Error("RPC client closed")): void {
    for (const id of [...this.#pending.keys()]) this.reject(id, error);
  }

  private reject(id: string, error: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    this.#timers.clearTimeout(pending.timeout);
    pending.reject(error);
  }
}
