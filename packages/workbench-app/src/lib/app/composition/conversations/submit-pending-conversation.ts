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
  agentProfilesDocumentSchema,
  type AgentProfilesDocument,
} from "@nervekit/contracts/agent-profiles";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";

type PendingSubmission = Pick<
  PendingConversationState,
  | "projectId"
  | "title"
  | "explicitAgentProfile"
  | "config"
  | "capabilityOverrides"
  | "agentProfileOverrides"
  | "agentProfileDigest"
  | "createdConversationId"
>;
type SnapshotIdentity = {
  conversation: { id: string };
  config: { agentProfile: string };
};
type Dependencies<Snapshot extends SnapshotIdentity> = {
  create(input: {
    projectId: string;
    title: string;
    config: Omit<ConversationConfig, "conversationId" | "agentProfile"> & {
      agentProfile?: string;
    };
  }): Promise<Snapshot>;
  getSnapshot(conversationId: string): Promise<Snapshot>;
  /** Applies everything except the profile, which only `setAgentProfile` may change. */
  configure(
    conversationId: string,
    config: Omit<ConversationConfig, "conversationId" | "agentProfile">,
  ): Promise<unknown>;
  setAgentProfile(conversationId: string, profile: string): Promise<unknown>;
  saveCapabilities(input: {
    projectId: string;
    conversationId: string;
    layer: "conversation";
    replace: CapabilityOverridesDocument;
  }): Promise<unknown>;
  saveProfiles(input: {
    projectId: string;
    conversationId: string;
    document: AgentProfilesDocument;
    expectedDigest: string | null;
  }): Promise<{ digest: string | null }>;
  submit(conversationId: string, text: string): Promise<unknown>;
};

function withoutProfile(
  config: Omit<ConversationConfig, "conversationId">,
): Omit<ConversationConfig, "conversationId" | "agentProfile"> {
  const patch: Partial<typeof config> = { ...config };
  delete patch.agentProfile;
  return patch as Omit<ConversationConfig, "conversationId" | "agentProfile">;
}

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
  const profiles = pending.agentProfileOverrides
    ? agentProfilesDocumentSchema.parse(pending.agentProfileOverrides)
    : undefined;
  const projectId = pending.projectId;
  const explicitProfile = pending.explicitAgentProfile;
  const expectedDigest = pending.agentProfileDigest ?? null;
  let snapshot: Snapshot;
  if (pending.createdConversationId) {
    // A failed first send can leave a persisted conversation while the user keeps
    // editing the draft. Apply current settings before retrying the input.
    await dependencies.configure(
      pending.createdConversationId,
      withoutProfile(config),
    );
    snapshot = await dependencies.getSnapshot(pending.createdConversationId);
  } else {
    snapshot = await dependencies.create({
      projectId,
      title: pending.title,
      config: {
        ...withoutProfile(config),
        ...(explicitProfile ? { agentProfile: explicitProfile } : {}),
      },
    });
  }
  const conversationId = snapshot.conversation.id;
  if (
    pending.createdConversationId &&
    explicitProfile &&
    snapshot.config.agentProfile !== explicitProfile
  ) {
    // Retry drafts may explicitly change profiles after the conversation was created.
    await dependencies.setAgentProfile(conversationId, explicitProfile);
    snapshot = await dependencies.getSnapshot(conversationId);
  }
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
    pending.agentProfileDigest = saved.digest;
  }
  await dependencies.submit(conversationId, text);
  return snapshot;
}
