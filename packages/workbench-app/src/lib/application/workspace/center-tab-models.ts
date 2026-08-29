import type {
  AgentRecord,
  ConversationRecord,
  FilesystemFileResponse,
  GithubChecksSummary,
  ProjectRecord,
  TaskRecord,
} from "$lib/api";
import type { GitDiffArea } from "@nervekit/contracts";
import type { MermaidBlockLocator } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";
import type {
  FileDisplayMode,
  FileRenderKind,
} from "@nervekit/ui-kit/display/file-display";
import type { ConversationActivityState } from "$lib/domain/conversations/activity";

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
  displayMode: FileDisplayMode;
  wrapLines: boolean;
  renderKind?: FileRenderKind;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type MermaidTabModel = {
  kind: "mermaid";
  id: string;
  origin: "file" | "inline";
  path?: string;
  relativePath?: string;
  name?: string;
  locator?: MermaidBlockLocator;
  active: boolean;
  sending: boolean;
  error?: string;
};

export type DiffTabModel = {
  kind: "diff";
  id: string;
  path?: string;
  repo?: string;
  area?: GitDiffArea;
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

export type LogsTabModel = {
  kind: "logs";
  id: "logs";
  active: boolean;
  sending: boolean;
  error?: string;
};

export type DiscoverTabModel = {
  kind: "discover";
  id: "discover";
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
  | MermaidTabModel
  | PrTabModel
  | DiffTabModel
  | SettingsTabModel
  | LogsTabModel
  | DiscoverTabModel;
