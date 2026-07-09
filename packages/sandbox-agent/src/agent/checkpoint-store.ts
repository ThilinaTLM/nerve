import { readdir } from "node:fs/promises";
import path from "node:path";
import type { BoundedText, SandboxRunStatus } from "@nervekit/shared";
import { JsonStore } from "../state/json-store.js";

export type CheckpointScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

export type RunCheckpointKind =
  | "provider_request"
  | "tool_wait"
  | "input_resolution"
  | "approval_resolution"
  | "terminal"
  | "retry_decision";

export type RunCheckpointRecord = CheckpointScope & {
  checkpointId: string;
  kind: RunCheckpointKind;
  status: SandboxRunStatus;
  executionId?: string;
  attempt?: number;
  toolCallId?: string;
  waitId?: string;
  resolutionId?: string;
  transcriptEntryId?: string;
  createdAt: string;
  recoverable?: boolean;
  summary?: BoundedText;
  data?: Record<string, unknown>;
};

export class RunCheckpointStore {
  constructor(private readonly stateDir: string) {}

  async write(
    scope: CheckpointScope,
    record: Omit<RunCheckpointRecord, keyof CheckpointScope | "createdAt"> &
      Partial<Pick<RunCheckpointRecord, "createdAt">>,
  ): Promise<RunCheckpointRecord> {
    const next: RunCheckpointRecord = {
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
      createdAt: new Date().toISOString(),
      ...record,
    };
    await new JsonStore<RunCheckpointRecord>(
      this.pathFor(scope, next.checkpointId),
    ).write(next);
    return next;
  }

  async read(
    scope: CheckpointScope & { checkpointId: string },
  ): Promise<RunCheckpointRecord | undefined> {
    return new JsonStore<RunCheckpointRecord | undefined>(
      this.pathFor(scope, scope.checkpointId),
    ).read(undefined);
  }

  async list(scope: CheckpointScope): Promise<RunCheckpointRecord[]> {
    const root = this.rootFor(scope);
    const out: RunCheckpointRecord[] = [];
    for (const entry of await readdir(root).catch(() => [])) {
      if (!entry.endsWith(".json")) continue;
      const checkpoint = await this.read({
        ...scope,
        checkpointId: entry.replace(/\.json$/, ""),
      });
      if (checkpoint) out.push(checkpoint);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  pathFor(scope: CheckpointScope, checkpointId: string): string {
    return path.join(this.rootFor(scope), `${safe(checkpointId)}.json`);
  }

  private rootFor(scope: CheckpointScope): string {
    return path.join(
      this.stateDir,
      "conversations",
      scope.conversationId,
      "agents",
      scope.agentId,
      "runs",
      scope.runId,
      "checkpoints",
    );
  }
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
