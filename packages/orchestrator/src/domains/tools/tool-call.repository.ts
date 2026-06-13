import { join } from "node:path";
import type { ToolCallRecord } from "@nerve/shared";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import {
  appendJsonLine,
  type InitializedStorage,
  readJsonLines,
  rewriteJsonLines,
} from "../../infrastructure/storage/index.js";

export class ToolCallRepository {
  readonly records = new Map<string, ToolCallRecord>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<ToolCallRecord[]> {
    const toolCalls = await this.readLatest();
    for (const toolCall of toolCalls) {
      this.records.set(toolCall.id, toolCall);
      this.index.upsertToolCall(toolCall);
    }
    return toolCalls;
  }

  list(): ToolCallRecord[] {
    return [...this.records.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  get(toolCallId: string): ToolCallRecord {
    const toolCall = this.records.get(toolCallId);
    if (!toolCall) throw new Error("Tool call not found.");
    return toolCall;
  }

  findByProviderToolCallId(
    providerToolCallId: string | undefined,
  ): ToolCallRecord | undefined {
    if (!providerToolCallId) return undefined;
    return [...this.records.values()].find(
      (toolCall) =>
        toolCall.providerToolCallId === providerToolCallId ||
        toolCall.sourceToolCallId === providerToolCallId,
    );
  }

  async upsert(toolCall: ToolCallRecord): Promise<void> {
    this.records.set(toolCall.id, toolCall);
    this.index.upsertToolCall(toolCall);
    await appendJsonLine(this.path(), toolCall, 0o600);
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, toolCall] of this.records) {
      if (conversationIds.has(toolCall.conversationId)) {
        this.records.delete(id);
        this.index.deleteToolCall(id);
      }
    }
    await rewriteJsonLines(this.path(), this.list(), 0o600);
  }

  private async readLatest(): Promise<ToolCallRecord[]> {
    const values = await readJsonLines<ToolCallRecord>(this.path()).catch(
      () => [],
    );
    return latestById(values);
  }

  private path(): string {
    return join(this.storage.paths.home, "logs", "tool-calls.jsonl");
  }
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}
