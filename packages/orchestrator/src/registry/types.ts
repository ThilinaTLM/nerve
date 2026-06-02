import type { AgentRecord, SessionEntry } from "@nerve/shared";

export type AppendEntryInput = {
  id?: string;
  sessionId: string;
  agentId?: string;
  parentEntryId?: string | null;
  role: SessionEntry["role"];
  kind?: SessionEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
};

export type AppendEntryOptions = { mirrorToHarness?: boolean };

export type AgentStatus = AgentRecord["status"];
