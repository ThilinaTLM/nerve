import type {
  ConversationSnapshot,
  ConversationSummary,
} from "@nervekit/contracts/core";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";

/** Display projection only: never loads documents, resolves settings or invents
 * defaults. Missing/corrupt cache leaves agent fields unknown and history usable. */
export function cachedAgentFields(
  service: Pick<AgentConfigurationService, "getSummary">,
  id: string,
) {
  const cached = service.getSummary(id);
  if (!cached) return {};
  const { observedDigest: _, ...fields } = cached;
  void _;
  return fields;
}
export function cachedConversationSummary(
  service: Pick<AgentConfigurationService, "getSummary">,
  row: ConversationSummary,
): ConversationSummary {
  return { ...row, ...cachedAgentFields(service, row.id) };
}
export function cachedConversationSnapshot(
  service: Pick<AgentConfigurationService, "getSummary">,
  snapshot: ConversationSnapshot,
): ConversationSnapshot {
  return {
    ...snapshot,
    config: {
      ...snapshot.config,
      ...cachedAgentFields(service, snapshot.conversation.id),
    },
    children: snapshot.children.map((row) =>
      cachedConversationSummary(service, row),
    ),
  };
}
