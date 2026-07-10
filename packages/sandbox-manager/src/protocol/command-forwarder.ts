import type {
  NerveMessage,
  ProtocolErrorData,
  ProtocolResponseData,
  StructuredLogger,
} from "@nervekit/contracts";
import { createMessageFactory } from "@nervekit/protocol";

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
  if (code === "VALIDATION_FAILED") return 400;
  if (code === "RESOURCE_NOT_FOUND") return 404;
  if (code === "OPERATION_TIMEOUT") return 504;
  if (code === "SERVICE_UNAVAILABLE") return 503;
  if (code === "CONFLICT" || code === "IDEMPOTENCY_CONFLICT") return 409;
  return 500;
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
    private readonly sandboxId = "unknown",
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
    idempotencyKey?: string,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(
        new ForwardedCommandError(
          "SERVICE_UNAVAILABLE",
          "Sandbox command queue is full",
          503,
        ),
      );
    }
    const createMessage = createMessageFactory({
      source: { role: "sandbox_manager", id: "sandbox-manager" },
      target: { role: "sandbox_agent", id: this.sandboxId },
    });
    const request = createMessage("request", {
      method,
      params,
      idempotencyKey,
      timeoutMs,
    });
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(
          new ForwardedCommandError(
            "OPERATION_TIMEOUT",
            `Sandbox operation timed out: ${request.id}`,
            504,
          ),
        );
      }, timeoutMs);
      this.pending.set(request.id, {
        resolve,
        reject,
        timeout,
        method,
        startedAt,
      });
      socket.send(JSON.stringify(request));
    });
  }

  resolve(message: NerveMessage<ProtocolResponseData>): void {
    const id = message.replyTo ?? message.correlationId;
    if (id) this.resolvePending(id, message.data.result);
  }

  reject(message: NerveMessage<ProtocolErrorData>): void {
    const id = message.replyTo ?? message.correlationId;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.reject(
      new ForwardedCommandError(message.data.code, message.data.message),
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
    this.logger?.debug("forwarded operation resolved", {
      method: pending.method,
      requestId: id,
      durationMs: Date.now() - pending.startedAt,
    });
    pending.resolve(value);
  }
}
