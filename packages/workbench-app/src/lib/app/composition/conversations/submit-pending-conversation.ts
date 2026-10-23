import { leadSettingsOverridesSchema } from "@nervekit/contracts/agent-configuration";
import type { OperationParams } from "@nervekit/contracts/operations";
import type {
  LeadSettingsOverrides,
  ProfileTarget,
} from "@nervekit/contracts/agent-configuration";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";

type PendingSubmission = Pick<
  PendingConversationState,
  | "projectId"
  | "title"
  | "explicitAgentProfile"
  | "config"
  | "overrides"
  | "createdConversationId"
>;
type SnapshotIdentity = {
  conversation: { id: string };
  config: { agentProfile: string };
};
type Dependencies<Snapshot extends SnapshotIdentity> = {
  create(
    input: Omit<OperationParams<"conversation.create">, "id">,
  ): Promise<Snapshot>;
  getSnapshot(conversationId: string): Promise<Snapshot>;
  configure(
    conversationId: string,
    config: NonNullable<OperationParams<"conversation.create">["config"]>,
  ): Promise<unknown>;
  resolveProfile(projectId: string, name: string): Promise<ProfileTarget>;
  setAgentProfile(conversationId: string, profile: string): Promise<unknown>;
  saveOverrides(
    conversationId: string,
    overrides: LeadSettingsOverrides,
  ): Promise<unknown>;
  submit(conversationId: string, text: string): Promise<unknown>;
};

/** Record creation before sending so a failed first input never duplicates a conversation. */
export async function submitPendingConversation<
  Snapshot extends SnapshotIdentity,
>(
  pending: PendingSubmission,
  text: string,
  dependencies: Dependencies<Snapshot>,
): Promise<Snapshot> {
  const { systemPrompt, instructions, workingDirectory } = pending.config;
  const config = { systemPrompt, instructions, workingDirectory };
  const overrides = leadSettingsOverridesSchema.parse(pending.overrides ?? {});
  const explicitProfile = pending.explicitAgentProfile;
  const retrying = pending.createdConversationId !== undefined;
  let snapshot: Snapshot;
  if (pending.createdConversationId) {
    await dependencies.configure(pending.createdConversationId, config);
    snapshot = await dependencies.getSnapshot(pending.createdConversationId);
    if (explicitProfile && snapshot.config.agentProfile !== explicitProfile) {
      await dependencies.setAgentProfile(
        pending.createdConversationId,
        explicitProfile,
      );
      snapshot = await dependencies.getSnapshot(pending.createdConversationId);
    }
  } else {
    const agentProfile = explicitProfile
      ? await dependencies.resolveProfile(pending.projectId, explicitProfile)
      : undefined;
    snapshot = await dependencies.create({
      projectId: pending.projectId,
      title: pending.title,
      config,
      overrides,
      ...(agentProfile ? { agentProfile } : {}),
    });
  }
  const conversationId = snapshot.conversation.id;
  pending.createdConversationId = conversationId;
  if (retrying) await dependencies.saveOverrides(conversationId, overrides);
  await dependencies.submit(conversationId, text);
  return snapshot;
}
