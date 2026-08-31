import type {
  AgentRecord,
  ConversationRecord,
  ProjectEditor,
  ProjectRecord,
  PruneProjectConversationsRequest,
  StatusResponse,
  UpdateConversationStateRequest,
} from "$lib/api";
import type { ConversationActivityState } from "$lib/domain/conversations/activity";

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
  projects?: ProjectRecord[];
  conversations?: ConversationRecord[];
  agents?: AgentRecord[];
  homeDir?: string;
  selectedProjectId?: string;
  selectedConversationId?: string;
  openConversationTabIds?: Set<string>;
  conversationActivityById?: Record<string, ConversationActivityState>;
  searchFocusToken?: number;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  terminalAvailability?: StatusResponse["runtime"]["terminal"];
  onOpenConversation?: (conversationId: string) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  onOpenProjectInTerminal?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onUpdateConversationState?: (
    conversationId: string,
    request: UpdateConversationStateRequest,
  ) => void;
  onPruneProjectConversations?: (
    projectId: string,
    request: PruneProjectConversationsRequest,
  ) => void;
};
