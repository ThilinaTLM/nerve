import type { ConfigurationVersion } from "@nervekit/contracts/agent-configuration";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import { requestConversation } from "$lib/application/startup/conversation-connection";

export function getHarnessSettings(_projectId: string, conversationId: string) {
  return requestConversation("agentConfiguration.getEffective", {
    conversationId,
  });
}

export async function updateHarnessCompaction(
  _projectId: string,
  conversationId: string,
  compaction: AutoCompactionSettings | null,
  version: ConfigurationVersion,
) {
  const scope = { scope: "conversation" as const, conversationId };
  const result = await requestConversation("agentConfiguration.save", {
    scope,
    expectedRevision: version.revision,
    expectedDigest: version.digest,
    changes: compaction === null ? {} : { compaction },
    resets: compaction === null ? ["/overrides/compaction"] : [],
  });
  if (result.status !== "saved")
    throw new Error(`Configuration ${result.status}. Refresh and try again.`);
  return getHarnessSettings(_projectId, conversationId);
}
