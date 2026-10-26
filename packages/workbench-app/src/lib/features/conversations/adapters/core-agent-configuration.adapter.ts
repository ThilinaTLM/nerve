import { requestConversation } from "$lib/application/startup/conversation-connection";

/** Capture the catalog target and CAS version together before switching. */
export async function switchAgentProfile(conversationId: string, name: string) {
  const preview = await requestConversation(
    "conversation.previewAgentProfile",
    { conversationId, profile: name },
  );
  if (preview.status !== "ready")
    throw new Error("Profile unavailable. Refresh and try again.");
  const result = await requestConversation("conversation.setAgentProfile", {
    conversationId,
    action: "switch",
    targetProfile: preview.preview.targetProfile,
    expectedRevision: preview.preview.expectedRevision,
    expectedDigest: preview.preview.expectedDigest,
  });
  if (result.status !== "applied")
    throw new Error(`Profile ${result.status}. Refresh and try again.`);
  return result;
}
