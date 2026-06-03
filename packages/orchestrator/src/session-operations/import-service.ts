import {
  type AgentRecord,
  agentRecordSchema,
  type CreateAgentRequest,
  type CreateProjectRequest,
  type CreateSessionRequest,
  type ImportSessionRequest,
  type ProjectRecord,
  type SessionEntry,
  type SessionRecord,
  sessionEntrySchema,
} from "@nerve/shared";
import type { EventBus } from "../events.js";
import type { AppendSessionEntry } from "./compaction-service.js";

export class ImportService {
  constructor(
    private readonly createProject: (
      request: CreateProjectRequest,
    ) => Promise<ProjectRecord>,
    private readonly createSession: (
      request: CreateSessionRequest,
    ) => Promise<SessionRecord>,
    private readonly createAgent: (
      request: CreateAgentRequest,
    ) => Promise<AgentRecord>,
    private readonly getSession: (sessionId: string) => SessionRecord,
    private readonly appendEntry: AppendSessionEntry,
    private readonly rebuildConversations: () => Promise<void>,
    private readonly events: EventBus,
  ) {}

  async importSession(request: ImportSessionRequest): Promise<{
    project: ProjectRecord;
    session: SessionRecord;
    agents: AgentRecord[];
    entries: SessionEntry[];
  }> {
    const project = await this.createProject({
      dir: request.project?.dir ?? process.cwd(),
      name: request.project?.name,
    });
    const session = await this.createSession({
      projectId: project.id,
      title: request.session.title ?? "Imported session",
      mode: request.session.mode,
      permissionLevel: request.session.permissionLevel,
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
        sessionId: session.id,
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
      .map((entry) => sessionEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
    const entryIdMap = new Map<string, string>();
    const importedEntries: SessionEntry[] = [];
    for (const entry of entries) {
      const imported = await this.appendEntry({
        sessionId: session.id,
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
      });
      entryIdMap.set(entry.id, imported.id);
      importedEntries.push(imported);
    }
    await this.rebuildConversations();
    await this.events.publish("session.imported", {
      project,
      session: this.getSession(session.id),
      entryCount: importedEntries.length,
    });
    return {
      project,
      session: this.getSession(session.id),
      agents: importedAgents,
      entries: importedEntries,
    };
  }
}
