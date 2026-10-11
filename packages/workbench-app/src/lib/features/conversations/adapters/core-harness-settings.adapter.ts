import { requestConversation } from "$lib/application/startup/conversation-connection";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";

export function getHarnessSettings(projectId: string, conversationId: string) {
  return requestConversation("harnessSettings.get", {
    projectId,
    conversationId,
  });
}

/** `null` removes the conversation override, returning to the inherited value. */
export function updateHarnessCompaction(
  projectId: string,
  conversationId: string,
  compaction: AutoCompactionSettings | null,
) {
  return requestConversation("harnessSettings.update", {
    projectId,
    conversationId,
    compaction,
  });
}
