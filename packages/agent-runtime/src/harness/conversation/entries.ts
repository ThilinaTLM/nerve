import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.js";
import type { Conversation } from "./conversation.js";

export interface ConversationTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends ConversationTreeEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends ConversationTreeEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends ConversationTreeEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface ActiveToolsChangeEntry extends ConversationTreeEntryBase {
  type: "active_tools_change";
  activeToolNames: string[];
}

export interface CompactionEntry<T = unknown>
  extends ConversationTreeEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
}

export interface BranchSummaryEntry<T = unknown>
  extends ConversationTreeEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

export interface CustomEntry<T = unknown> extends ConversationTreeEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

export interface CustomMessageEntry<T = unknown>
  extends ConversationTreeEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}

export interface LabelEntry extends ConversationTreeEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface ConversationInfoEntry extends ConversationTreeEntryBase {
  type: "conversation_info";
  name?: string;
}

export interface LeafEntry extends ConversationTreeEntryBase {
  type: "leaf";
  targetId: string | null;
}

export type ConversationTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | ConversationInfoEntry
  | LeafEntry;

export interface ConversationMetadata {
  id: string;
  createdAt: string;
}

export interface JsonlConversationMetadata extends ConversationMetadata {
  cwd: string;
  path: string;
  parentConversationPath?: string;
}

export interface ConversationStorage<
  TMetadata extends ConversationMetadata = ConversationMetadata,
> {
  getMetadata(): Promise<TMetadata>;
  getLeafId(): Promise<string | null>;
  /** Persist a leaf entry that records the active conversation-tree leaf. */
  setLeafId(leafId: string | null): Promise<void>;
  createEntryId(): Promise<string>;
  appendEntry(entry: ConversationTreeEntry): Promise<void>;
  getEntry(id: string): Promise<ConversationTreeEntry | undefined>;
  findEntries<TType extends ConversationTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<ConversationTreeEntry, { type: TType }>>>;
  getLabel(id: string): Promise<string | undefined>;
  getPathToRoot(leafId: string | null): Promise<ConversationTreeEntry[]>;
  getEntries(): Promise<ConversationTreeEntry[]>;
}

export type { Conversation } from "./conversation.js";

export interface ConversationCreateOptions {
  id?: string;
}

export interface ConversationForkOptions {
  entryId?: string;
  position?: "before" | "at";
  id?: string;
}

export interface ConversationRepo<
  TMetadata extends ConversationMetadata = ConversationMetadata,
  TCreateOptions extends ConversationCreateOptions = ConversationCreateOptions,
  TListOptions = void,
> {
  create(options: TCreateOptions): Promise<Conversation<TMetadata>>;
  open(metadata: TMetadata): Promise<Conversation<TMetadata>>;
  list(options?: TListOptions): Promise<TMetadata[]>;
  delete(metadata: TMetadata): Promise<void>;
  fork(
    source: TMetadata,
    options: ConversationForkOptions & TCreateOptions,
  ): Promise<Conversation<TMetadata>>;
}

export interface JsonlConversationCreateOptions
  extends ConversationCreateOptions {
  cwd: string;
  parentConversationPath?: string;
}

export interface JsonlConversationListOptions {
  cwd?: string;
}

export interface JsonlConversationRepoApi
  extends ConversationRepo<
    JsonlConversationMetadata,
    JsonlConversationCreateOptions,
    JsonlConversationListOptions
  > {}
