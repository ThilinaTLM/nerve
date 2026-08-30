import type { AgentRecord, ProjectRecord } from "$lib/api";

type VoiceInputTarget =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string };

export interface WorkspaceFeatureCommands {
  cancelVoiceInputTargets(targets: VoiceInputTarget[]): Promise<void>;
  openPendingConversation(
    project: ProjectRecord,
    initialMode?: AgentRecord["mode"],
  ): void;
  removeConversationTabs(conversationIds: string[]): Promise<void>;
}

let commands: WorkspaceFeatureCommands | undefined;

export function registerWorkspaceFeatureCommands(
  implementation: WorkspaceFeatureCommands,
): void {
  commands = implementation;
}

function registeredCommands(): WorkspaceFeatureCommands {
  if (!commands)
    throw new Error("Workspace feature commands are not registered");
  return commands;
}

export function cancelWorkspaceVoiceInputTargets(
  targets: VoiceInputTarget[],
): Promise<void> {
  return registeredCommands().cancelVoiceInputTargets(targets);
}

export function openWorkspacePendingConversation(
  project: ProjectRecord,
  initialMode?: AgentRecord["mode"],
): void {
  registeredCommands().openPendingConversation(project, initialMode);
}

export function removeWorkspaceConversationTabs(
  conversationIds: string[],
): Promise<void> {
  return registeredCommands().removeConversationTabs(conversationIds);
}
