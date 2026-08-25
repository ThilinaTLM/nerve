import type {
  AgentRecord,
  ConversationEntry,
  ConversationEntryUsage,
} from "@nervekit/contracts";

export type AppendEntryInput = {
  id?: string;
  conversationId: string;
  agentId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  messageOrdinal?: number;
  parentEntryId?: string | null;
  role: ConversationEntry["role"];
  kind?: ConversationEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  usage?: ConversationEntryUsage;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
};

export type AppendEntryOptions = { mirrorToHarness?: boolean };

export type AgentStatus = AgentRecord["status"];
