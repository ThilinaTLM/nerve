import {
  type StructuredLogger,
  sandboxProtocolErrorSchema,
  sandboxProtocolResponseSchema,
} from "@nervekit/contracts";
import { encodeProtocolMessage } from "./messages.js";

export type CommandSocket = { send(data: string): void };

export class ForwardedCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = forwardedCommandStatus(code),
  ) {
    super(message);
    this.name = "ForwardedCommandError";
  }
}

function forwardedCommandStatus(code: string): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "UNKNOWN_RUN":
    case "RESOURCE_NOT_FOUND":
      return 404;
    case "IDEMPOTENCY_CONFLICT":
    case "ALREADY_RESOLVED":
    case "INVALID_RUN_STATE":
    case "COMMAND_FAILED":
      return 409;
    case "OPERATION_TIMEOUT":
      return 504;
    case "UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
      return 503;
    default:
      if (code.startsWith("GIT_") || code.startsWith("GH_")) return 409;
      return 500;
  }
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
  method: string;
  startedAt: number;
};

export class CommandForwarder {
  private readonly pending = new Map<string, Pending>();
  private readonly maxPending: number;
  private readonly logger?: StructuredLogger;
  constructor(
    options: { maxPending?: number; logger?: StructuredLogger } = {},
  ) {
    this.maxPending = options.maxPending ?? 100;
    this.logger = options.logger;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  send(
    socket: CommandSocket,
    method: string,
    params: unknown,
    id = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (this.pending.size >= this.maxPending) {
      this.logger?.warn("forwarded command rejected: queue full", {
        method,
        requestId: id,
        pending: this.pending.size,
      });
      return Promise.reject(
        new ForwardedCommandError(
          "SERVICE_UNAVAILABLE",
          "Sandbox command queue is full",
          503,
        ),
      );
    }
    const startedAt = Date.now();
    this.logger?.debug("forwarding command to controller", {
      method,
      requestId: id,
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.logger?.error("forwarded command timed out", {
          method,
          requestId: id,
          timeoutMs,
        });
        reject(
          new ForwardedCommandError(
            "OPERATION_TIMEOUT",
            `Sandbox command timed out: ${id}`,
            504,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method, startedAt });
      socket.send(
        encodeProtocolMessage({ type: "request", id, method, params } as never),
      );
    });
  }

  resolve(messageOrId: unknown, value?: unknown): void {
    if (typeof messageOrId === "string") {
      this.resolvePending(messageOrId, value);
      return;
    }
    const response = sandboxProtocolResponseSchema.parse(messageOrId);
    this.resolvePending(response.id, response.result);
  }

  reject(messageOrId: unknown): void {
    const parsed = sandboxProtocolErrorSchema.parse(messageOrId);
    if (!parsed.id) return;
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(parsed.id);
    this.logger?.warn("forwarded command errored", {
      method: pending.method,
      requestId: parsed.id,
      code: parsed.error.code,
      durationMs: Date.now() - pending.startedAt,
    });
    pending.reject(
      new ForwardedCommandError(parsed.error.code, parsed.error.message),
    );
  }

  failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private resolvePending(id: string, value: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    this.logger?.debug("forwarded command resolved", {
      method: pending.method,
      requestId: id,
      durationMs: Date.now() - pending.startedAt,
    });
    pending.resolve(value);
  }
}
