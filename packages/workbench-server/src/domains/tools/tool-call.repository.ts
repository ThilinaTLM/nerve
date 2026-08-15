import { open, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toolCallRecordSchema, type ToolCallRecord } from "@nervekit/contracts";
import type { IndexStore } from "../../infrastructure/index-store/index-store.js";
import {
  atomicWriteJson,
  type InitializedStorage,
} from "../../infrastructure/storage/index.js";

export interface ToolCallHydrationStats {
  rowCount: number;
  uniqueCount: number;
  fileBytes: number;
  source: "files";
}

export class ToolCallRevisionConflictError extends Error {
  constructor(
    readonly toolCallId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `Tool call '${toolCallId}' revision conflict: expected ${expected}, current ${actual}.`,
    );
    this.name = "ToolCallRevisionConflictError";
  }
}

export class ToolCallRepository {
  readonly records: Map<string, ToolCallRecord> = new Map();
  private readonly mutations = new Map<string, Promise<void>>();
  private hydrationStats: ToolCallHydrationStats = {
    rowCount: 0,
    uniqueCount: 0,
    fileBytes: 0,
    source: "files",
  };

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<ToolCallRecord[]> {
    this.records.clear();
    let fileBytes = 0;
    const conversations = await readdir(
      join(this.storage.paths.home, "conversations"),
      { withFileTypes: true },
    ).catch(() => []);
    for (const conversation of conversations.sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!conversation.isDirectory() || !validId(conversation.name, "conv_"))
        continue;
      const directory = join(
        this.storage.paths.home,
        "conversations",
        conversation.name,
        "tool-calls",
      );
      const files = await readdir(directory, { withFileTypes: true }).catch(
        () => [],
      );
      for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!file.isFile() || !file.name.endsWith(".json")) continue;
        const id = file.name.slice(0, -5);
        if (!validId(id, "tool_"))
          throw new Error(
            `Invalid canonical tool-call filename '${file.name}'.`,
          );
        const raw = await import("node:fs/promises").then(({ readFile }) =>
          readFile(join(directory, file.name), "utf8"),
        );
        fileBytes += Buffer.byteLength(raw);
        const record = toolCallRecordSchema.parse(JSON.parse(raw));
        if (record.id !== id || record.conversationId !== conversation.name) {
          throw new Error(
            `Canonical tool-call path identity mismatch for '${id}'.`,
          );
        }
        if (this.records.has(id))
          throw new Error(`Duplicate canonical tool call '${id}'.`);
        this.records.set(id, record);
        this.index.upsertToolCall(record);
      }
    }
    this.hydrationStats = {
      rowCount: this.records.size,
      uniqueCount: this.records.size,
      fileBytes,
      source: "files",
    };
    return this.list();
  }

  get hydrationSource(): "files" {
    return "files";
  }
  get hydrationStatsValue(): ToolCallHydrationStats {
    return { ...this.hydrationStats };
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

  async create(toolCall: ToolCallRecord): Promise<ToolCallRecord> {
    const record = toolCallRecordSchema.parse({ ...toolCall, revision: 1 });
    return this.serialize(record.id, async () => {
      if (this.records.has(record.id))
        throw new Error(`Tool call '${record.id}' already exists.`);
      const path = this.path(record);
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(dirname(path), { recursive: true, mode: 0o755 }),
      );
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.records.set(record.id, record);
      this.index.upsertToolCall(record);
      return record;
    });
  }

  async replace(
    toolCallId: string,
    expectedRevision: number,
    mutate: (current: ToolCallRecord) => ToolCallRecord,
  ): Promise<ToolCallRecord> {
    return this.serialize(toolCallId, async () => {
      const current = this.get(toolCallId);
      if (current.revision !== expectedRevision) {
        throw new ToolCallRevisionConflictError(
          toolCallId,
          expectedRevision,
          current.revision,
        );
      }
      if (isTerminal(current.status))
        throw new Error(`Terminal tool call '${toolCallId}' is immutable.`);
      const candidate = mutate(current);
      assertImmutableIdentity(current, candidate);
      const next = toolCallRecordSchema.parse({
        ...candidate,
        revision: current.revision + 1,
      });
      await atomicWriteJson(this.path(next), next, 0o600);
      this.records.set(next.id, next);
      try {
        this.index.upsertToolCall(next);
      } catch {
        /* Canonical file remains authoritative. */
      }
      return next;
    });
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, record] of [...this.records]) {
      if (!conversationIds.has(record.conversationId)) continue;
      this.records.delete(id);
      this.index.deleteToolCall(id);
    }
  }

  private path(record: Pick<ToolCallRecord, "id" | "conversationId">): string {
    if (
      !validId(record.id, "tool_") ||
      !validId(record.conversationId, "conv_")
    )
      throw new Error("Invalid tool-call storage identity.");
    return join(
      this.storage.paths.home,
      "conversations",
      record.conversationId,
      "tool-calls",
      `${record.id}.json`,
    );
  }

  private async serialize<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.mutations.set(id, tail);
    try {
      return await result;
    } finally {
      if (this.mutations.get(id) === tail) this.mutations.delete(id);
    }
  }
}

const immutableKeys = [
  "id",
  "agentId",
  "conversationId",
  "projectId",
  "toolName",
  "sourceToolCallId",
  "providerToolCallId",
  "runId",
  "turnId",
  "liveMessageId",
  "contentIndex",
  "risk",
  "args",
  "cwd",
  "createdAt",
] as const;
function assertImmutableIdentity(
  current: ToolCallRecord,
  next: ToolCallRecord,
): void {
  for (const key of immutableKeys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key]))
      throw new Error(`Tool-call identity field '${key}' is immutable.`);
  }
}
function validId(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(value);
}
function isTerminal(status: ToolCallRecord["status"]): boolean {
  return ["completed", "denied", "failed", "cancelled"].includes(status);
}
