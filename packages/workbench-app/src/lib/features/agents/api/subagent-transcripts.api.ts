import type { SubagentTranscriptSnapshot } from "@nervekit/contracts/agents";
import { protocolRequest } from "@nervekit/protocol/adapters";

export async function getSubagentTranscript(
  parentAgentId: string,
  childAgentId: string,
): Promise<SubagentTranscriptSnapshot> {
  return (
    await protocolRequest("agent.subagentTranscript.get", {
      parentAgentId,
      childAgentId,
    })
  ).result.transcript;
}
