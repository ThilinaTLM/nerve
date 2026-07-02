import {
  type SandboxCommandRecord,
  type SandboxCommandResultRecord,
  sandboxCommandParamsHash,
  sandboxCommandRecordSchema,
  sandboxCommandResultRecordSchema,
  sandboxStableDigest,
} from "@nervekit/shared";
import { JsonlStore } from "./jsonl-store.js";

export type AcceptedCommand = {
  record: SandboxCommandRecord;
  duplicate: boolean;
  result?: SandboxCommandResultRecord;
};

export class CommandInbox {
  private readonly store: JsonlStore<SandboxCommandRecord>;
  private readonly results: JsonlStore<SandboxCommandResultRecord>;
  private index = new Map<string, SandboxCommandRecord>();
  private resultIndex = new Map<string, SandboxCommandResultRecord>();
  constructor(
    filePath: string,
    resultPath = filePath.replace(/\.jsonl$/, ".results.jsonl"),
  ) {
    this.store = new JsonlStore(filePath, sandboxCommandRecordSchema);
    this.results = new JsonlStore(resultPath, sandboxCommandResultRecordSchema);
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
    const paramsHash = sandboxCommandParamsHash(input.params);
    const existing = this.index.get(input.commandId);
    if (existing) {
      if (existing.paramsHash !== paramsHash)
        throw new Error(`IDEMPOTENCY_CONFLICT: ${input.commandId}`);
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
      responseHash: sandboxStableDigest(result),
      completedAt: new Date().toISOString(),
    };
    await this.results.append(record);
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
    this.resultIndex.set(commandId, record);
    return record;
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
}
