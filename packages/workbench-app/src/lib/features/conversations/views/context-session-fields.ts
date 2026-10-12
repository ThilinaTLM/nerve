import type {
  ConversationRecord,
  ProjectRecord,
} from "$lib/presentation/view-models/conversation";
import type { SessionField } from "$lib/presentation/composer/session-info";
import type { StatusResponse } from "@nervekit/contracts/status";

export type SessionFieldsInput = {
  status?: StatusResponse;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
};

/** The conversation's own directory under the daemon's data directory. */
export function conversationDataPath(
  dataDir: string | undefined,
  conversationId: string | undefined,
): string | undefined {
  if (!dataDir || !conversationId) return undefined;
  return `${dataDir.replace(/[\\/]+$/, "")}/conversations/${conversationId}`;
}

/** Session rows for the composer's context popover. */
export function sessionFields({
  status,
  activeProject,
  activeConversation,
}: SessionFieldsInput): SessionField[] {
  return [
    { label: "Project", value: activeProject?.name },
    { label: "Directory", value: activeProject?.dir, mono: true },
    { label: "Conversation", value: activeConversation?.id, mono: true },
    { label: "Daemon", value: status?.daemonId, mono: true },
    {
      label: "Data",
      value: conversationDataPath(status?.dataDir, activeConversation?.id),
      mono: true,
    },
  ];
}
