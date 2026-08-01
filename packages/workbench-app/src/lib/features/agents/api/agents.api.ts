import type { AgentRecord, ModelSelection } from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function updateAgentConfig(
  agentId: string,
  patch: {
    model?: ModelSelection | null;
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    approvalPolicy?: AgentRecord["approvalPolicy"];
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
