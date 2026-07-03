import path from "node:path";
import type { SandboxToolCallRecord } from "@nervekit/shared";
import { JsonlStore } from "../state/jsonl-store.js";

export type ToolCallScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

export class ToolCallStore {
  constructor(private readonly stateDir: string) {}

  async append(
    scope: ToolCallScope,
    record: Omit<SandboxToolCallRecord, keyof ToolCallScope> &
      Partial<ToolCallScope>,
  ): Promise<SandboxToolCallRecord> {
    const next: SandboxToolCallRecord = {
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      ...record,
      requestedAt: record.requestedAt ?? new Date().toISOString(),
    } as SandboxToolCallRecord;
    await new JsonlStore<SandboxToolCallRecord>(this.pathFor(scope)).append(
      next,
    );
    return next;
  }

  async list(scope: ToolCallScope): Promise<SandboxToolCallRecord[]> {
    return new JsonlStore<SandboxToolCallRecord>(this.pathFor(scope)).readAll();
  }

  async latestByToolCallId(
    scope: ToolCallScope,
  ): Promise<Map<string, SandboxToolCallRecord>> {
    const latest = new Map<string, SandboxToolCallRecord>();
    for (const record of await this.list(scope)) {
      const current = latest.get(record.toolCallId);
      if (
        !current ||
        (record.lifecycleSeq ?? 0) >= (current.lifecycleSeq ?? 0) ||
        (record.completedAt ?? record.startedAt ?? record.requestedAt) >=
          (current.completedAt ?? current.startedAt ?? current.requestedAt)
      ) {
        latest.set(record.toolCallId, record);
      }
    }
    return latest;
  }

  pathFor(scope: ToolCallScope): string {
    return path.join(
      this.stateDir,
      "conversations",
      scope.conversationId,
      "agents",
      scope.agentId,
      "runs",
      scope.runId,
      "tools",
      "tool-calls.jsonl",
    );
  }
}
