import {
  sandboxProtocolErrorSchema,
  sandboxProtocolResponseSchema,
} from "@nervekit/shared";
import { encodeProtocolMessage } from "./messages.js";

export type CommandSocket = { send(data: string): void };

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

export class CommandForwarder {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly maxPending = 100) {}

  send(
    socket: CommandSocket,
    method: string,
    params: unknown,
    id = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (this.pending.size >= this.maxPending)
      return Promise.reject(new Error("Sandbox command queue is full"));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sandbox command timed out: ${id}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
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
    pending.reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
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
    pending.resolve(value);
  }
}
