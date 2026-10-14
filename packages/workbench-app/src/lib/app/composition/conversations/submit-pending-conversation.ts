import {
  capabilityOverridesDocumentSchema,
  emptyCapabilityOverrides,
  type CapabilityOverridesDocument,
} from "@nervekit/contracts/capabilities";
import {
  conversationConfigSchema,
  type ConversationConfig,
} from "@nervekit/contracts/core";
import {
  subagentProfilesDocumentSchema,
  type SubagentProfilesDocument,
} from "@nervekit/contracts/subagents";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";

type PendingSubmission = Pick<
  PendingConversationState,
  | "projectId"
  | "title"
  | "config"
  | "capabilityOverrides"
  | "subagentProfileOverrides"
  | "subagentProfileDigest"
  | "createdConversationId"
>;
type SnapshotIdentity = { conversation: { id: string } };
type Dependencies<Snapshot extends SnapshotIdentity> = {
  create(input: {
    projectId: string;
    title: string;
    config: Omit<ConversationConfig, "conversationId">;
  }): Promise<Snapshot>;
  getSnapshot(conversationId: string): Promise<Snapshot>;
  saveCapabilities(input: {
    projectId: string;
    conversationId: string;
    layer: "conversation";
    replace: CapabilityOverridesDocument;
  }): Promise<unknown>;
  saveProfiles(input: {
    projectId: string;
    conversationId: string;
    document: SubagentProfilesDocument;
    expectedDigest: string | null;
  }): Promise<{ digest: string | null }>;
  submit(conversationId: string, text: string): Promise<unknown>;
};

/** Caller owns the sending guard and promotion/navigation after success. */
export async function submitPendingConversation<
  Snapshot extends SnapshotIdentity,
>(
  pending: PendingSubmission,
  text: string,
  dependencies: Dependencies<Snapshot>,
): Promise<Snapshot> {
  // Parse to snapshot nested reactive state before the first await. Never submit
  // input against a partially saved draft, even if navigation changes meanwhile.
  const config = conversationConfigSchema
    .omit({ conversationId: true })
    .parse(pending.config);
  const capabilities = capabilityOverridesDocumentSchema.parse(
    pending.capabilityOverrides ?? emptyCapabilityOverrides(),
  );
  const profiles = pending.subagentProfileOverrides
    ? subagentProfilesDocumentSchema.parse(pending.subagentProfileOverrides)
    : undefined;
  const projectId = pending.projectId;
  const expectedDigest = pending.subagentProfileDigest ?? null;
  const snapshot = pending.createdConversationId
    ? await dependencies.getSnapshot(pending.createdConversationId)
    : await dependencies.create({ projectId, title: pending.title, config });
  const conversationId = snapshot.conversation.id;
  // Record each successful stage immediately so a downstream failure is retryable.
  pending.createdConversationId = conversationId;
  await dependencies.saveCapabilities({
    projectId,
    conversationId,
    layer: "conversation",
    replace: capabilities,
  });
  if (profiles) {
    const saved = await dependencies.saveProfiles({
      projectId,
      conversationId,
      document: profiles,
      expectedDigest,
    });
    pending.subagentProfileDigest = saved.digest;
  }
  await dependencies.submit(conversationId, text);
  return snapshot;
}
