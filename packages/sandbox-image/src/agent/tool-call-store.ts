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
      latest.set(
        record.toolCallId,
        current ? projectToolCallRecord(current, record) : record,
      );
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

function projectToolCallRecord(
  current: SandboxToolCallRecord,
  next: SandboxToolCallRecord,
): SandboxToolCallRecord {
  const useLifecycle = isNewerLifecycle(next, current);
  return {
    ...current,
    ...(useLifecycle
      ? {
          toolName: next.toolName,
          status: next.status,
          lifecycleSeq: next.lifecycleSeq ?? current.lifecycleSeq,
        }
      : {}),
    requestedAt: earliestIso(current.requestedAt, next.requestedAt),
    startedAt: latestIso(current.startedAt, next.startedAt),
    completedAt: latestIso(current.completedAt, next.completedAt),
    cancelledAt: latestIso(current.cancelledAt, next.cancelledAt),
    displayArgs:
      next.displayArgs === undefined ? current.displayArgs : next.displayArgs,
    args: next.args === undefined ? current.args : next.args,
    result: next.result === undefined ? current.result : next.result,
    artifactRefs:
      next.artifactRefs === undefined
        ? current.artifactRefs
        : next.artifactRefs,
    approvalId:
      next.approvalId === undefined ? current.approvalId : next.approvalId,
    error: next.error === undefined ? current.error : next.error,
    redactionVersion:
      next.redactionVersion === undefined
        ? current.redactionVersion
        : next.redactionVersion,
  };
}

function isNewerLifecycle(
  next: SandboxToolCallRecord,
  current: SandboxToolCallRecord,
): boolean {
  const nextSeq = next.lifecycleSeq ?? 0;
  const currentSeq = current.lifecycleSeq ?? 0;
  if (nextSeq !== currentSeq) return nextSeq > currentSeq;
  return lifecycleTimestamp(next) >= lifecycleTimestamp(current);
}

function lifecycleTimestamp(record: SandboxToolCallRecord): string {
  return (
    latestIso(record.cancelledAt, record.completedAt, record.startedAt) ??
    record.requestedAt
  );
}

function earliestIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function latestIso<T extends string | undefined>(
  ...values: T[]
): T | undefined {
  return values
    .filter((value): value is T & string => Boolean(value))
    .sort()
    .at(-1);
}
