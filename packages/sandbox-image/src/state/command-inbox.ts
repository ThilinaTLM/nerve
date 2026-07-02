import {
  type SandboxCommandRecord,
  sandboxCommandParamsHash,
  sandboxCommandRecordSchema,
} from "@nervekit/shared";
import { JsonlStore } from "./jsonl-store.js";

export type AcceptedCommand = {
  record: SandboxCommandRecord;
  duplicate: boolean;
};

export class CommandInbox {
  private readonly store: JsonlStore<SandboxCommandRecord>;
  private index = new Map<string, SandboxCommandRecord>();
  constructor(filePath: string) {
    this.store = new JsonlStore(filePath, sandboxCommandRecordSchema);
  }
  async load(): Promise<void> {
    this.index = new Map(
      (await this.store.readAll()).map((record) => [record.commandId, record]),
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
      return { record: existing, duplicate: true };
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
  get(commandId: string): SandboxCommandRecord | undefined {
    return this.index.get(commandId);
  }
  list(): SandboxCommandRecord[] {
    return Array.from(this.index.values());
  }
}
