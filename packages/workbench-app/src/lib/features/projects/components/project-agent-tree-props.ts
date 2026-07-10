import type {
  AgentRecord,
  ConversationRecord,
  ProjectEditor,
  ProjectRecord,
  PruneProjectConversationsRequest,
  StatusResponse,
} from "$lib/api";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";

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
  onOpenConversation?: (conversationId: string) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onPruneProjectConversations?: (
    projectId: string,
    request: PruneProjectConversationsRequest,
  ) => void;
};
