import {
  conversationConfigSchema,
  conversationSchema,
} from "@nervekit/contracts/core";
import type { EventMapping } from "./events.mapper.js";
import { iso, type Legacy, type LegacyReader } from "./legacy.reader.js";

export interface ImportScope {
  id: string;
  sourceAgentId: string;
  head: string | null;
  sequence: number;
  lastUserMessageAt: string | null;
  status: "idle" | "failed" | "interrupted";
  statusSequence: number;
}

export function importConversationScopes(
  reader: LegacyReader,
  mapping: EventMapping,
  conversation: Legacy,
  agents: Legacy[],
) {
  const rootId = mapping.ids.get("conv", conversation.id);
  const rootAgent =
    agents.find(
      (agent) =>
        agent.id === conversation.activeAgentId && !agent.parentAgentId,
    ) ?? agents.find((agent) => !agent.parentAgentId);
  let historicalModel: Legacy | undefined;
  if (!rootAgent?.model && !conversation.model) {
    for (const { data } of reader.records(conversation.id, "message")) {
      const message = data.modelContext?.entry?.message;
      if (message?.role === "assistant" && message.provider && message.model)
        historicalModel = {
          provider: message.provider,
          modelId: message.model,
        };
    }
    if (!historicalModel)
      throw new Error(
        "Missing model selection and no assistant history from which to recover it",
      );
    mapping.report.loss(
      "Missing root agent configuration; recovered model from latest assistant history",
    );
  }
  const scopes = new Map<string, ImportScope>();
  const agentImportScopes = new Map<string, ImportScope>();
  const projectId = mapping.ids.get("proj", conversation.projectId);
  const project = mapping.storage.projects.get(projectId);
  if (!project) throw new Error(`Missing project ${conversation.projectId}`);
  const create = (agent: Legacy, parent: ImportScope | null): ImportScope => {
    const id = parent ? mapping.ids.get("conv", agent.id) : rootId;
    const scope: ImportScope = {
      id,
      sourceAgentId: agent.id,
      head: null,
      sequence: 0,
      lastUserMessageAt: null,
      status: "idle",
      statusSequence: 0,
    };
    const createdAt = iso(parent ? agent.createdAt : conversation.createdAt);
    mapping.storage.conversations.insert(
      conversationSchema.parse({
        id,
        projectId,
        parentConversationId: parent?.id ?? null,
        parentToolCallId: null,
        headEventId: null,
        title: parent
          ? (agent.name ?? agent.task?.slice(0, 100) ?? "Child conversation")
          : (conversation.title ?? "Imported conversation"),
        status: "idle",
        statusEventSequence: 0,
        statusClearedAt: parent
          ? null
          : (conversation.runtimeStatusClearedAt ?? null),
        paused: agent.activationState === "paused",
        nextInputSequence: 1,
        pinnedAt: parent ? null : (conversation.pinnedAt ?? null),
        completedAt: parent ? null : (conversation.completedAt ?? null),
        lastUserMessageAt: null,
        createdAt,
        updatedAt: iso(agent.updatedAt ?? conversation.updatedAt, createdAt),
      }),
      conversationConfigSchema.parse({
        conversationId: id,
        model:
          agent.model ??
          conversation.model ??
          rootAgent?.model ??
          historicalModel,
        reasoningLevel:
          agent.thinkingLevel ?? conversation.thinkingLevel ?? "off",
        systemPrompt: agent.systemPrompt ?? null,
        permissionRuleSetId:
          agent.executionKind === "explore" ||
          agent.orchestrationPolicy?.preset === "explore"
            ? "read_only"
            : (agent.permissionRuleSetId ??
              conversation.permissionRuleSetId ??
              agent.permissionLevel ??
              conversation.permissionLevel ??
              "supervised"),
        mode: agent.mode ?? conversation.mode ?? "coding",
        workingDirectory: agent.projectDir ?? project.directory,
      }),
    );
    scopes.set(id, scope);
    agentImportScopes.set(agent.id, scope);
    if (agent.instructions)
      mapping.report.loss(
        "Legacy instructions not part of new conversation configuration",
      );
    return scope;
  };
  const root = create(rootAgent ?? conversation, null);
  const remaining = agents.filter((agent) => agent.parentAgentId);
  while (remaining.length) {
    const index = remaining.findIndex((agent) =>
      agentImportScopes.has(agent.parentAgentId),
    );
    if (index < 0)
      throw new Error("Child agents have missing parents or a parent cycle");
    const agent = remaining.splice(index, 1)[0];
    create(agent, agentImportScopes.get(agent.parentAgentId)!);
  }
  for (const agent of agents.filter((agent) => !agent.parentAgentId))
    agentImportScopes.set(agent.id, root);
  const owner = (agentId: unknown): ImportScope =>
    typeof agentId === "string"
      ? (agentImportScopes.get(agentId) ?? root)
      : root;
  return { rootId, scopes, owner, project };
}
