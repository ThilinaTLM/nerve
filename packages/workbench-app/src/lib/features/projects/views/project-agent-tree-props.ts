import type { ConversationUpdate } from "$lib/application/workspace/workspace-actions.svelte";
import type { ProjectEditor, StatusResponse } from "$lib/api";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { Project } from "@nervekit/contracts/core";
import type { ConversationActivity } from "$lib/application/workspace/conversation-activity";

export type DeleteTarget = {
  kind: "project" | "conversation";
  id: string;
  label: string;
};

export type PruneTarget = {
  id: string;
  label: string;
};

export type ProjectAgentTreeProps = {
  projects?: Project[];
  conversations?: ConversationSummary[];
  homeDir?: string;
  selectedProjectId?: string;
  selectedConversationId?: string;
  openConversationTabIds?: Set<string>;
  conversationActivityById?: Record<string, ConversationActivity>;
  searchFocusToken?: number;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  terminalAvailability?: StatusResponse["runtime"]["terminal"];
  maintenanceActive?: boolean;
  onOpenConversation?: (conversationId: string) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  onOpenProjectInTerminal?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onUpdateConversationState?: (
    conversationId: string,
    request: ConversationUpdate,
  ) => void;
};
