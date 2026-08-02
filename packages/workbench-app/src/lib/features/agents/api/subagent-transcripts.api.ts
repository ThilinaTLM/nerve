import type { SubagentTranscriptSnapshot } from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

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
