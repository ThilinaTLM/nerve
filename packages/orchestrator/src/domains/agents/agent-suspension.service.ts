import { join } from "node:path";
import {
  type AgentSuspensionRecord,
  agentSuspensionRecordSchema,
  createId,
  type SuspensionStatus,
} from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
  appendJsonLine,
  readJsonLines,
  rewriteJsonLines,
} from "../../infrastructure/storage/index.js";

export class AgentSuspensionService {
  readonly suspensions = new Map<string, AgentSuspensionRecord>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
  ) {}

  async hydrate(): Promise<void> {
    for (const suspension of await this.readLatestSuspensions()) {
      this.suspensions.set(suspension.id, suspension);
    }
  }

  listSuspensions(status?: SuspensionStatus): AgentSuspensionRecord[] {
    return [...this.suspensions.values()]
      .filter((suspension) => !status || suspension.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  pendingForToolCall(toolCallId: string): AgentSuspensionRecord | undefined {
    return this.listSuspensions("pending").find(
      (suspension) => suspension.toolCallId === toolCallId,
    );
  }

  pendingForAgent(agentId: string): AgentSuspensionRecord | undefined {
    return this.listSuspensions("pending").find(
      (suspension) => suspension.agentId === agentId,
    );
  }

  getSuspension(id: string): AgentSuspensionRecord {
    const suspension = this.suspensions.get(id);
    if (!suspension) throw new Error("Agent suspension not found.");
    return suspension;
  }

  async removeSuspensionsForConversations(
    conversationIds: Iterable<string>,
  ): Promise<void> {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return;
    for (const [id, suspension] of this.suspensions) {
      if (conversations.has(suspension.conversationId)) {
        this.suspensions.delete(id);
      }
    }
    await rewriteJsonLines(
      this.suspensionsPath(),
      this.listSuspensions(),
      0o600,
    );
  }

  async createSuspension(
    input: Omit<
      AgentSuspensionRecord,
      "id" | "status" | "createdAt" | "updatedAt"
    >,
  ): Promise<AgentSuspensionRecord> {
    const existing = this.pendingForToolCall(input.toolCallId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const suspension: AgentSuspensionRecord = {
      ...input,
      id: createId("susp"),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await this.upsertSuspension(suspension);
    await this.events.publish("agent.suspension.created", { suspension });
    return suspension;
  }

  async updateSuspension(
    id: string,
    patch: Partial<Omit<AgentSuspensionRecord, "id" | "createdAt">>,
  ): Promise<AgentSuspensionRecord> {
    const current = this.getSuspension(id);
    const updated: AgentSuspensionRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertSuspension(updated);
    await this.events.publish("agent.suspension.updated", {
      suspension: updated,
    });
    return updated;
  }

  private async upsertSuspension(
    suspension: AgentSuspensionRecord,
  ): Promise<void> {
    this.suspensions.set(suspension.id, suspension);
    await appendJsonLine(this.suspensionsPath(), suspension, 0o600);
  }

  private async readLatestSuspensions(): Promise<AgentSuspensionRecord[]> {
    const values = await readJsonLines<unknown>(this.suspensionsPath()).catch(
      () => [],
    );
    const parsed = values
      .map((value) => agentSuspensionRecordSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data);
    return latestById(parsed);
  }

  private suspensionsPath(): string {
    return join(this.storage.paths.home, "suspensions", "suspensions.jsonl");
  }
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}
