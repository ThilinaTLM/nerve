import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.js";
import type { Session } from "./session.js";

export interface SessionTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface ActiveToolsChangeEntry extends SessionTreeEntryBase {
  type: "active_tools_change";
  activeToolNames: string[];
}

export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}

export interface LabelEntry extends SessionTreeEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionTreeEntryBase {
  type: "session_info"; // legacy name, kept for backwards compatibility
  name?: string;
}

export interface LeafEntry extends SessionTreeEntryBase {
  type: "leaf";
  targetId: string | null;
}

export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry;

export interface SessionMetadata {
  id: string;
  createdAt: string;
}

export interface JsonlSessionMetadata extends SessionMetadata {
  cwd: string;
  path: string;
  parentSessionPath?: string;
}

export interface SessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> {
  getMetadata(): Promise<TMetadata>;
  getLeafId(): Promise<string | null>;
  /** Persist a leaf entry that records the active session-tree leaf. */
  setLeafId(leafId: string | null): Promise<void>;
  createEntryId(): Promise<string>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;
  getLabel(id: string): Promise<string | undefined>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  getEntries(): Promise<SessionTreeEntry[]>;
}

export type { Session } from "./session.js";

export interface SessionCreateOptions {
  id?: string;
}

export interface SessionForkOptions {
  entryId?: string;
  position?: "before" | "at";
  id?: string;
}

export interface SessionRepo<
  TMetadata extends SessionMetadata = SessionMetadata,
  TCreateOptions extends SessionCreateOptions = SessionCreateOptions,
  TListOptions = void,
> {
  create(options: TCreateOptions): Promise<Session<TMetadata>>;
  open(metadata: TMetadata): Promise<Session<TMetadata>>;
  list(options?: TListOptions): Promise<TMetadata[]>;
  delete(metadata: TMetadata): Promise<void>;
  fork(
    source: TMetadata,
    options: SessionForkOptions & TCreateOptions,
  ): Promise<Session<TMetadata>>;
}

export interface JsonlSessionCreateOptions extends SessionCreateOptions {
  cwd: string;
  parentSessionPath?: string;
}

export interface JsonlSessionListOptions {
  cwd?: string;
}

export interface JsonlSessionRepoApi
  extends SessionRepo<
    JsonlSessionMetadata,
    JsonlSessionCreateOptions,
    JsonlSessionListOptions
  > {}
