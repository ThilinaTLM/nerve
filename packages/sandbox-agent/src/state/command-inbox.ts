import path from "node:path";
import {
  type SandboxCommandDecisionRecord,
  type SandboxCommandRecord,
  type SandboxCommandResultRecord,
  sandboxCommandDecisionRecordSchema,
  sandboxCommandRecordSchema,
  sandboxCommandResultRecordSchema,
} from "@nervekit/shared";
import { sandboxCommandParamsSha256, sandboxResponseSha256 } from "./hash.js";
import { JsonlStore } from "./jsonl-store.js";

export type AcceptedCommand = {
  record: SandboxCommandRecord;
  duplicate: boolean;
  result?: SandboxCommandResultRecord;
};

function defaultDecisionsPath(filePath: string): string {
  if (path.basename(filePath) === "inbox.jsonl") {
    return path.join(path.dirname(filePath), "decisions.jsonl");
  }
  return filePath.endsWith(".jsonl")
    ? filePath.replace(/\.jsonl$/, ".decisions.jsonl")
    : `${filePath}.decisions.jsonl`;
}

export class CommandInbox {
  private readonly store: JsonlStore<SandboxCommandRecord>;
  private readonly results: JsonlStore<SandboxCommandResultRecord>;
  private readonly decisions: JsonlStore<SandboxCommandDecisionRecord>;
  private index = new Map<string, SandboxCommandRecord>();
  private resultIndex = new Map<string, SandboxCommandResultRecord>();

  constructor(
    filePath: string,
    resultPath = filePath.replace(/\.jsonl$/, ".results.jsonl"),
    decisionsPath = defaultDecisionsPath(filePath),
  ) {
    this.store = new JsonlStore(filePath, sandboxCommandRecordSchema);
    this.results = new JsonlStore(resultPath, sandboxCommandResultRecordSchema);
    this.decisions = new JsonlStore(
      decisionsPath,
      sandboxCommandDecisionRecordSchema,
    );
  }

  async load(): Promise<void> {
    this.index = new Map(
      (await this.store.readAll()).map((record) => [record.commandId, record]),
    );
    this.resultIndex = new Map(
      (await this.results.readAll()).map((record) => [
        record.commandId,
        record,
      ]),
    );
  }

  async accept(
    input: Omit<
      SandboxCommandRecord,
      "paramsHash" | "acceptedAt" | "status"
    > & { params: unknown },
  ): Promise<AcceptedCommand> {
    const paramsHash = sandboxCommandParamsSha256(input.params);
    const existing = this.index.get(input.commandId);
    if (existing) {
      if (existing.paramsHash !== paramsHash) {
        await this.appendDecision({
          commandId: input.commandId,
          method: input.method,
          paramsHash,
          decision: "conflict",
          reason: "same commandId used with different params hash",
        });
        throw new Error(`IDEMPOTENCY_CONFLICT: ${input.commandId}`);
      }
      await this.appendDecision({
        commandId: input.commandId,
        method: existing.method,
        paramsHash: existing.paramsHash,
        decision: "duplicate",
        resultRef: this.resultIndex.has(input.commandId)
          ? `${input.commandId}:result`
          : undefined,
      });
      return {
        record: existing,
        duplicate: true,
        result: this.resultIndex.get(input.commandId),
      };
    }
    const record: SandboxCommandRecord = {
      ...input,
      paramsHash,
      acceptedAt: new Date().toISOString(),
      status: "accepted",
    };
    await this.store.append(record);
    await this.appendDecision({
      commandId: record.commandId,
      method: record.method,
      paramsHash: record.paramsHash,
      decision: "accepted",
    });
    this.index.set(record.commandId, record);
    return { record, duplicate: false };
  }

  async complete(
    commandId: string,
    result: unknown,
  ): Promise<SandboxCommandResultRecord> {
    const command = this.index.get(commandId);
    if (!command) throw new Error(`Unknown command: ${commandId}`);
    const record: SandboxCommandResultRecord = {
      commandId,
      method: command.method,
      status: "completed",
      result,
      responseHash: sandboxResponseSha256(result),
      completedAt: new Date().toISOString(),
    };
    await this.results.append(record);
    await this.appendDecision({
      commandId,
      method: command.method,
      paramsHash: command.paramsHash,
      decision: "completed",
      resultRef: `${commandId}:result`,
    });
    this.resultIndex.set(commandId, record);
    return record;
  }

  async fail(
    commandId: string,
    error: { code: string; message: string },
  ): Promise<SandboxCommandResultRecord> {
    const command = this.index.get(commandId);
    if (!command) throw new Error(`Unknown command: ${commandId}`);
    const record: SandboxCommandResultRecord = {
      commandId,
      method: command.method,
      status: "failed",
      error,
      completedAt: new Date().toISOString(),
    };
    await this.results.append(record);
    await this.appendDecision({
      commandId,
      method: command.method,
      paramsHash: command.paramsHash,
      decision: "failed",
      error,
    });
    this.resultIndex.set(commandId, record);
    return record;
  }

  async cancel(commandId: string): Promise<SandboxCommandResultRecord> {
    const command = this.index.get(commandId);
    if (!command) throw new Error(`Unknown command: ${commandId}`);
    const record: SandboxCommandResultRecord = {
      commandId,
      method: command.method,
      status: "cancelled",
      completedAt: new Date().toISOString(),
    };
    await this.results.append(record);
    await this.appendDecision({
      commandId,
      method: command.method,
      paramsHash: command.paramsHash,
      decision: "cancelled",
      resultRef: `${commandId}:result`,
    });
    this.resultIndex.set(commandId, record);
    return record;
  }

  async appendRecoveryDecision(
    commandId: string,
    reason: string,
  ): Promise<void> {
    const command = this.index.get(commandId);
    await this.appendDecision({
      commandId,
      method: command?.method,
      paramsHash: command?.paramsHash,
      decision: "recovered",
      reason,
    });
  }

  get(commandId: string): SandboxCommandRecord | undefined {
    return this.index.get(commandId);
  }

  getResult(commandId: string): SandboxCommandResultRecord | undefined {
    return this.resultIndex.get(commandId);
  }

  list(): SandboxCommandRecord[] {
    return Array.from(this.index.values());
  }

  private async appendDecision(
    decision: Omit<SandboxCommandDecisionRecord, "decidedAt">,
  ): Promise<void> {
    await this.decisions.append({
      ...decision,
      decidedAt: new Date().toISOString(),
    });
  }
}
