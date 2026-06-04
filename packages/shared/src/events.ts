import { z } from "zod";

export type AgentMessageContentKind = "text" | "thinking";

export interface AgentMessageStartedEventData {
  agentId: string;
  runId: string;
  sessionId: string;
  messageId?: string;
}

export interface AgentMessageContentDeltaEventData {
  agentId: string;
  runId: string;
  sessionId: string;
  contentIndex: number;
  kind: AgentMessageContentKind;
  delta: string;
}

export interface AgentMessageContentDoneEventData {
  agentId: string;
  runId: string;
  sessionId: string;
  contentIndex: number;
  kind: AgentMessageContentKind;
  content?: string;
  redacted?: boolean;
}

export interface AgentToolCallDraftStartedEventData {
  agentId: string;
  runId: string;
  sessionId: string;
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
}

export interface AgentToolCallDraftDeltaEventData {
  agentId: string;
  runId: string;
  sessionId: string;
  contentIndex: number;
  delta: string;
}

export interface AgentToolCallDraftDoneEventData {
  agentId: string;
  runId: string;
  sessionId: string;
  contentIndex: number;
  providerToolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export const eventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  id: z.string().startsWith("evt_"),
  ts: z.string().datetime(),
  type: z.string().min(1),
  data: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "data"
> & {
  data: T;
};
