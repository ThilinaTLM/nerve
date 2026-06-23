import type {
  AgentRecord,
  ConversationRecord,
  FilesystemFileResponse,
  GithubChecksSummary,
  ProjectRecord,
  TaskRecord,
} from "$lib/api";
import type { defaultFileDisplayMode } from "$lib/core/utils/file-display";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";

export type ConversationTabModel = {
  kind: "conversation";
  id: string;
  conversation: ConversationRecord;
  project?: ProjectRecord;
  agent?: AgentRecord;
  active: boolean;
  hasDraft: boolean;
  sending: boolean;
  activity: ConversationActivityState;
  error?: string;
};

export type PendingConversationTabModel = {
  kind: "pending-conversation";
  id: string;
  title: "New Conversation";
  project?: ProjectRecord;
  projectDir: string;
  active: boolean;
  hasDraft: boolean;
  sending: boolean;
  activity: ConversationActivityState;
  error?: string;
};

export type TaskTabModel = {
  kind: "task";
  id: string;
  task?: TaskRecord;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type FileTabModel = {
  kind: "file";
  id: string;
  file?: FilesystemFileResponse;
  path?: string;
  relativePath?: string;
  displayMode: ReturnType<typeof defaultFileDisplayMode>;
  wrapLines: boolean;
  markdown: boolean;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type SettingsTabModel = {
  kind: "settings";
  id: "settings";
  active: boolean;
  sending: boolean;
  error?: string;
};

export type AuthTabModel = {
  kind: "auth";
  id: "auth";
  active: boolean;
  sending: boolean;
  error?: string;
};

export type LogsTabModel = {
  kind: "logs";
  id: "logs";
  active: boolean;
  sending: boolean;
  error?: string;
};

export type PrTabModel = {
  kind: "pr";
  id: string;
  number: number;
  title?: string;
  checksStatus?: GithubChecksSummary["status"];
  isDraft?: boolean;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type CenterTabModel =
  | ConversationTabModel
  | PendingConversationTabModel
  | TaskTabModel
  | FileTabModel
  | PrTabModel
  | SettingsTabModel
  | AuthTabModel
  | LogsTabModel;
