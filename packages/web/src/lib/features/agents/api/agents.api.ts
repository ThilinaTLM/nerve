import type { AgentRecord, ModelSelection } from "@nerve/shared";
import { apiPatch, apiPathSegment } from "../../../shared/api/client";

export async function updateAgentConfig(
  agentId: string,
  patch: {
    model?: ModelSelection | null;
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    thinkingLevel?: AgentRecord["thinkingLevel"];
  },
): Promise<AgentRecord> {
  return (
    await apiPatch<{ agent: AgentRecord }>(
      `/api/agents/${apiPathSegment(agentId)}`,
      patch,
    )
  ).agent;
}

export async function updateAgentModel(
  agentId: string,
  model: ModelSelection | undefined,
): Promise<AgentRecord> {
  return updateAgentConfig(agentId, { model: model ?? null });
}
