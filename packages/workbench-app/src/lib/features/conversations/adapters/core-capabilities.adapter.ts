import type { OperationParams } from "@nervekit/contracts/operations";
import { requestConversation } from "$lib/application/startup/conversation-connection";

export function getCapabilityConfiguration(
  projectId: string,
  conversationId?: string,
) {
  return requestConversation("capabilities.get", { projectId, conversationId });
}

export function updateCapabilities(
  input: OperationParams<"capabilities.update">,
) {
  return requestConversation("capabilities.update", input);
}

export function resetCapabilities(
  input: OperationParams<"capabilities.reset">,
) {
  return requestConversation("capabilities.reset", input);
}

export function trustCapabilities(projectId: string, digest: string) {
  return requestConversation("capabilities.trust", { projectId, digest });
}
