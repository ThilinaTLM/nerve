import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  PruneProjectConversationsRequest,
  UpdateConversationStateRequest,
} from "$lib/domain/projects/sidebar-view-models";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";

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
  currentRepositories?: Readonly<Record<string, string | undefined>>;
  projects?: ProjectRecord[];
  conversations?: ConversationRecord[];
  agents?: AgentRecord[];
  homeDir?: string;
  selectedProjectId?: string;
  selectedConversationId?: string;
  openConversationTabIds?: Set<string>;
  conversationActivityById?: Record<string, ConversationActivity>;
  searchFocusToken?: number;
  maintenanceActive?: boolean;
  onOpenConversation?: (conversationId: string) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectSettings?: (projectId: string) => void;
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
