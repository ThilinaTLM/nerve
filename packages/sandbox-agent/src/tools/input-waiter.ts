import path from "node:path";
import type { SandboxInputWaitRecord } from "@nervekit/shared";
import { JsonlStore } from "../state/jsonl-store.js";

export type InputWaitRequest = {
  requestId: string;
  conversationId: string;
  agentId: string;
  runId: string;
  question: { text: string; truncated?: boolean; bytes?: number };
  context?: string;
  recommendation?: string;
  placeholder?: string;
  expiresAt?: string;
  redactedDisplay?: { text: string; truncated?: boolean; bytes?: number };
};

export class InputWaiter {
  private readonly waits = new Map<string, SandboxInputWaitRecord>();
  private readonly store: JsonlStore<SandboxInputWaitRecord>;

  constructor(stateDir: string) {
    this.store = new JsonlStore(path.join(stateDir, "waits", "inputs.jsonl"));
  }

  async load(): Promise<void> {
    this.waits.clear();
    for (const record of await this.store.readAll())
      this.waits.set(record.requestId, record);
  }

  async request(input: InputWaitRequest): Promise<SandboxInputWaitRecord> {
    const existing = this.waits.get(input.requestId);
    if (existing) return existing;
    const record: SandboxInputWaitRecord = {
      ...input,
      status: "waiting",
      createdAt: new Date().toISOString(),
    };
    this.waits.set(record.requestId, record);
    await this.store.append(record);
    return record;
  }

  async submit(input: {
    requestId: string;
    conversationId?: string;
    agentId?: string;
    runId?: string;
    text: string;
    commandId?: string;
    toolResultEntryId?: string;
    checkpointId?: string;
  }): Promise<SandboxInputWaitRecord> {
    const current = this.waits.get(input.requestId);
    if (!current) throw new Error(`Unknown input request: ${input.requestId}`);
    assertScope(current, input);
    if (current.status === "submitted") {
      if (current.response?.text !== input.text)
        throw new Error(`Conflicting input submission: ${input.requestId}`);
      return current;
    }
    if (current.status !== "waiting")
      throw new Error(`Input request already resolved: ${input.requestId}`);
    if (current.expiresAt && current.expiresAt <= new Date().toISOString()) {
      const expired = {
        ...current,
        status: "expired" as const,
        resolvedAt: new Date().toISOString(),
      };
      this.waits.set(input.requestId, expired);
      await this.store.append(expired);
      throw new Error(`Input request expired: ${input.requestId}`);
    }
    const next: SandboxInputWaitRecord = {
      ...current,
      status: "submitted",
      resolvedAt: new Date().toISOString(),
      resumeCommandId: input.commandId,
      toolResultEntryId: input.toolResultEntryId,
      checkpointId: input.checkpointId,
      response: { text: input.text },
    };
    this.waits.set(input.requestId, next);
    await this.store.append(next);
    return next;
  }

  async cancelRun(scope: {
    conversationId?: string;
    agentId?: string;
    runId: string;
  }): Promise<SandboxInputWaitRecord[]> {
    const cancelled: SandboxInputWaitRecord[] = [];
    for (const wait of this.waits.values()) {
      if (wait.status !== "waiting") continue;
      if (scope.conversationId && wait.conversationId !== scope.conversationId)
        continue;
      if (scope.agentId && wait.agentId !== scope.agentId) continue;
      if (wait.runId !== scope.runId) continue;
      const next: SandboxInputWaitRecord = {
        ...wait,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
      };
      this.waits.set(wait.requestId, next);
      await this.store.append(next);
      cancelled.push(next);
    }
    return cancelled;
  }

  resolutionForRequest(requestId: string): SandboxInputWaitRecord | undefined {
    const wait = this.waits.get(requestId);
    return wait?.status === "submitted" ? wait : undefined;
  }

  get(requestId: string): SandboxInputWaitRecord | undefined {
    return this.waits.get(requestId);
  }

  pendingForRun(scope: {
    conversationId?: string;
    agentId?: string;
    runId: string;
  }): SandboxInputWaitRecord[] {
    return this.list().filter(
      (wait) =>
        wait.status === "waiting" &&
        (!scope.conversationId ||
          wait.conversationId === scope.conversationId) &&
        (!scope.agentId || wait.agentId === scope.agentId) &&
        wait.runId === scope.runId,
    );
  }

  list(): SandboxInputWaitRecord[] {
    return Array.from(this.waits.values());
  }
}

function assertScope(
  record: SandboxInputWaitRecord,
  scope: { conversationId?: string; agentId?: string; runId?: string },
): void {
  if (scope.conversationId && scope.conversationId !== record.conversationId)
    throw new Error(`Input request conversation mismatch: ${record.requestId}`);
  if (scope.agentId && scope.agentId !== record.agentId)
    throw new Error(`Input request agent mismatch: ${record.requestId}`);
  if (scope.runId && scope.runId !== record.runId)
    throw new Error(`Input request run mismatch: ${record.requestId}`);
}
