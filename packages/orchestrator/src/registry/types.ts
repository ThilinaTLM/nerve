import type {
  AgentRecord,
  SessionEntry,
  SessionEntryUsage,
} from "@nerve/shared";

export type AppendEntryInput = {
  id?: string;
  sessionId: string;
  agentId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  parentEntryId?: string | null;
  role: SessionEntry["role"];
  kind?: SessionEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  usage?: SessionEntryUsage;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
};

export type AppendEntryOptions = { mirrorToHarness?: boolean };

export type AgentStatus = AgentRecord["status"];
