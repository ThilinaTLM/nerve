import type { AgentRecord, ModelSelection } from "@nervekit/shared";
import { protocolRequest } from "../../../core/protocol/http-client";

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
    await protocolRequest<{ agent: AgentRecord }>("agent.configure", {
      agentId,
      ...patch,
    })
  ).result.agent;
}

export async function updateAgentModel(
  agentId: string,
  model: ModelSelection | undefined,
): Promise<AgentRecord> {
  return updateAgentConfig(agentId, { model: model ?? null });
}
