import { join } from "node:path";
import {
  createId,
  type PromptRequest,
  type QueuedPromptBehavior,
  type QueuedPromptRecord,
  queuedPromptRecordSchema,
} from "@nervekit/shared";
import {
  appendJsonLine,
  type InitializedStorage,
  listChildDirs,
  readJsonLines,
} from "../../infrastructure/storage/index.js";

export interface EnqueuePromptInput {
  agentId: string;
  conversationId: string;
  projectId: string;
  runId?: string;
  behavior: QueuedPromptBehavior;
  text: string;
  images?: PromptRequest["images"];
}

export class PromptQueueRepository {
  constructor(private readonly storage: InitializedStorage) {}

  queuePath(agentId: string): string {
    return join(
      this.storage.paths.home,
      "agents",
      agentId,
      "prompt-queue.jsonl",
    );
  }

  async enqueue(input: EnqueuePromptInput): Promise<QueuedPromptRecord> {
    const now = new Date().toISOString();
    const record: QueuedPromptRecord = {
      id: createId("promptq"),
      agentId: input.agentId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      runId: input.runId,
      behavior: input.behavior,
      text: input.text,
      images: input.images,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  async markAccepted(
    id: string,
    agentId: string,
    runId: string,
  ): Promise<QueuedPromptRecord | undefined> {
    return this.patch(agentId, id, { status: "accepted", runId });
  }

  async markDelivered(
    id: string,
    agentId: string,
    deliveredEntryId?: string,
  ): Promise<QueuedPromptRecord | undefined> {
    return this.patch(agentId, id, {
      status: "delivered",
      deliveredEntryId,
    });
  }

  async markFailed(
    id: string,
    agentId: string,
    error: string,
  ): Promise<QueuedPromptRecord | undefined> {
    return this.patch(agentId, id, { status: "failed", error });
  }

  async cancel(
    id: string,
    agentId: string,
  ): Promise<QueuedPromptRecord | undefined> {
    const current = await this.get(agentId, id);
    if (!current || current.status === "delivered") return current;
    return this.patch(agentId, id, { status: "cancelled" });
  }

  async pendingForAgent(agentId: string): Promise<QueuedPromptRecord[]> {
    return (await this.loadForAgent(agentId)).filter(
      (record) => record.status === "queued" || record.status === "accepted",
    );
  }

  async hydrateAll(): Promise<QueuedPromptRecord[]> {
    const root = join(this.storage.paths.home, "agents");
    const records: QueuedPromptRecord[] = [];
    for (const agentId of await listChildDirs(root)) {
      records.push(...(await this.loadForAgent(agentId)));
    }
    return records;
  }

  async get(
    agentId: string,
    id: string,
  ): Promise<QueuedPromptRecord | undefined> {
    return (await this.loadForAgent(agentId)).find(
      (record) => record.id === id,
    );
  }

  async loadForAgent(agentId: string): Promise<QueuedPromptRecord[]> {
    const lines = await readJsonLines<unknown>(this.queuePath(agentId)).catch(
      () => [],
    );
    const byId = new Map<string, QueuedPromptRecord>();
    for (const line of lines) {
      const parsed = queuedPromptRecordSchema.safeParse(line);
      if (parsed.success) byId.set(parsed.data.id, parsed.data);
    }
    return [...byId.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  private async patch(
    agentId: string,
    id: string,
    patch: Partial<Omit<QueuedPromptRecord, "id" | "agentId" | "createdAt">>,
  ): Promise<QueuedPromptRecord | undefined> {
    const current = await this.get(agentId, id);
    if (!current) return undefined;
    const updated = queuedPromptRecordSchema.parse({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    await this.write(updated);
    return updated;
  }

  private async write(record: QueuedPromptRecord): Promise<void> {
    await appendJsonLine(this.queuePath(record.agentId), record, 0o600);
  }
}
