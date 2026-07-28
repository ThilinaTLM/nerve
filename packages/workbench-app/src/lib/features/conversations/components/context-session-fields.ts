import type {
  ConversationRecord,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";

export type SessionField = { label: string; value?: string; mono?: boolean };

export type SessionFieldsInput = {
  status?: StatusResponse;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
};

const PERMISSION_LABELS: Record<string, string> = {
  read_only: "read only",
  supervised: "supervised",
  autonomous: "autonomous",
};

/** Agent-facing permission wording; agent rows render it inline, lower case. */
export function permissionLabel(permissionLevel: string): string {
  return PERMISSION_LABELS[permissionLevel] ?? permissionLevel;
}

export function shortAgentId(id: string): string {
  const parts = id.split("_");
  return parts.length > 1 ? (parts.at(-1) ?? id) : id.slice(-6);
}

/**
 * Session-scoped rows only. Agent details (model, mode, permission, thinking)
 * live on the agent rows below, so nothing is stated twice.
 */
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
    { label: "Data", value: status?.dataDir, mono: true },
  ];
}

export function sessionFieldsText(fields: readonly SessionField[]): string {
  return fields
    .map((field) => `${field.label}: ${field.value ?? "—"}`)
    .join("\n");
}
