import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ModelSelection } from "@nervekit/contracts/models";
import { protocolRequest } from "@nervekit/protocol/adapters";

export async function updateAgentConfig(
  agentId: string,
  patch: {
    model?: ModelSelection | null;
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    permissionRuleSetId?: NonNullable<AgentRecord["permissionRuleSetId"]>;
    thinkingLevel?: AgentRecord["thinkingLevel"];
  },
): Promise<AgentRecord> {
  const result = (
    await protocolRequest("agent.configure", {
      agentId,
      ...patch,
    })
  ).result;
  if (!("agent" in result)) {
    throw new Error("Workbench agent configuration returned an async result");
  }
  return result.agent;
}
