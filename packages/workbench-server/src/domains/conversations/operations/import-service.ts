import {
  type AgentRecord,
  agentRecordSchema,
  type ConversationEntry,
  type ConversationRecord,
  type CreateAgentRequest,
  type CreateConversationRequest,
  type CreateProjectRequest,
  conversationEntrySchema,
  type ImportConversationRequest,
  type ProjectRecord,
} from "@nervekit/contracts";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { AppendConversationEntry } from "./compaction-service.js";

export class ImportService {
  constructor(
    private readonly createProject: (
      request: CreateProjectRequest,
    ) => Promise<ProjectRecord>,
    private readonly createConversation: (
      request: CreateConversationRequest,
    ) => Promise<ConversationRecord>,
    private readonly createAgent: (
      request: CreateAgentRequest,
    ) => Promise<AgentRecord>,
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly appendEntry: AppendConversationEntry,
    private readonly rebuildConversations: () => Promise<void>,
    private readonly events: EventBus,
  ) {}

  async importConversation(request: ImportConversationRequest): Promise<{
    project: ProjectRecord;
    conversation: ConversationRecord;
    agents: AgentRecord[];
    entries: ConversationEntry[];
  }> {
    const project = await this.createProject({
      dir: request.project?.dir ?? process.cwd(),
      name: request.project?.name,
    });
    const conversation = await this.createConversation({
      projectId: project.id,
      title: request.conversation.title ?? "Imported conversation",
      mode: request.conversation.mode,
      permissionLevel: request.conversation.permissionLevel,
    });
    const agentIdMap = new Map<string, string>();
    const importedAgents: AgentRecord[] = [];
    for (const candidate of request.agents ?? []) {
      const parsed = agentRecordSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const parentAgentId = parsed.data.parentAgentId
        ? agentIdMap.get(parsed.data.parentAgentId)
        : undefined;
      const agent = await this.createAgent({
        conversationId: conversation.id,
        projectId: project.id,
        projectDir: project.dir,
        parentAgentId,
        mode: parsed.data.mode,
        permissionLevel: parsed.data.permissionLevel,
        workspaceScope: { roots: [project.dir] },
        budget: parsed.data.budget,
        model: parsed.data.model,
        thinkingLevel: parsed.data.thinkingLevel,
      });
      agentIdMap.set(parsed.data.id, agent.id);
      importedAgents.push(agent);
    }
    const entries = [...(request.entries ?? [])]
      .map((entry) => conversationEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
    const entryIdMap = new Map<string, string>();
    const importedEntries: ConversationEntry[] = [];
    for (const entry of entries) {
      const imported = await this.appendEntry({
        conversationId: conversation.id,
        agentId: entry.agentId ? agentIdMap.get(entry.agentId) : undefined,
        parentEntryId: entry.parentEntryId
          ? (entryIdMap.get(entry.parentEntryId) ?? null)
          : null,
        role: entry.role,
        kind: entry.kind,
        text: entry.text,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        firstKeptEntryId: entry.firstKeptEntryId
          ? entryIdMap.get(entry.firstKeptEntryId)
          : undefined,
        fromEntryId: entry.fromEntryId
          ? entryIdMap.get(entry.fromEntryId)
          : undefined,
        details: entry.details,
        createdAt: entry.createdAt,
      });
      entryIdMap.set(entry.id, imported.id);
      importedEntries.push(imported);
    }
    await this.rebuildConversations();
    await this.events.publish("conversation.imported", {
      project,
      conversation: this.getConversation(conversation.id),
      entryCount: importedEntries.length,
    });
    return {
      project,
      conversation: this.getConversation(conversation.id),
      agents: importedAgents,
      entries: importedEntries,
    };
  }
}
