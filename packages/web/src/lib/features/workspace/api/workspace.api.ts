import type {
  AgentRecord,
  ConversationRecord,
  ProcessRecord,
  ProjectRecord,
} from "@nerve/shared";
import { apiGet } from "../../../core/api/client";

export type WorkspaceSnapshot = {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  processes: ProcessRecord[];
};

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [
    projectResponse,
    conversationResponse,
    agentResponse,
    processResponse,
  ] = await Promise.all([
    apiGet<{ projects: ProjectRecord[] }>("/api/projects"),
    apiGet<{ conversations: ConversationRecord[] }>("/api/conversations"),
    apiGet<{ agents: AgentRecord[] }>("/api/agents"),
    apiGet<{ processes: ProcessRecord[] }>("/api/processes"),
  ]);
  return {
    projects: projectResponse.projects,
    conversations: [...conversationResponse.conversations].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    agents: agentResponse.agents,
    processes: processResponse.processes,
  };
}
