import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  TaskRecord,
} from "@nervekit/shared";
import { apiGet } from "../../../core/api/client";

export type WorkspaceSnapshot = {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  tasks: TaskRecord[];
};

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [projectResponse, conversationResponse, agentResponse, taskResponse] =
    await Promise.all([
      apiGet<{ projects: ProjectRecord[] }>("/api/projects"),
      apiGet<{ conversations: ConversationRecord[] }>("/api/conversations"),
      apiGet<{ agents: AgentRecord[] }>("/api/agents"),
      apiGet<{ tasks: TaskRecord[] }>("/api/tasks"),
    ]);
  return {
    projects: projectResponse.projects,
    conversations: [...conversationResponse.conversations].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    agents: agentResponse.agents,
    tasks: taskResponse.tasks,
  };
}
