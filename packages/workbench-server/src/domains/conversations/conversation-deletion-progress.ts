import type { ConversationDeletionProgress } from "../../infrastructure/persistence/canonical-sqlite/conversation-deletion.js";

export interface ConversationRemovalProgress {
  conversationId: string;
  title?: string;
  stage:
    | "stopping_agents"
    | ConversationDeletionProgress["phase"]
    | "streams"
    | "payloads";
  removedRows: number;
  detachedLinks: number;
}
export interface ConversationRemovalOptions {
  prepare?: () => Promise<void>;
  operationId?: string;
  onProgress?: (progress: ConversationRemovalProgress) => void | Promise<void>;
}
export interface ConversationDeletionIntent {
  conversationId: string;
  projectId?: string;
  operationId?: string;
}
