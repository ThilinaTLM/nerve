import type { Message } from "@earendil-works/pi-ai";
import type { AgentRecord, PromptRequest } from "@nerve/shared";

export interface AgentRunState {
  runId: string;
  abort: () => void | Promise<void>;
  messages: Message[];
  steer?: (
    text: string,
    options?: PromptRequest,
    queuedPromptId?: string,
  ) => Promise<void>;
  followUp?: (
    text: string,
    options?: PromptRequest,
    queuedPromptId?: string,
  ) => Promise<void>;
  updateAgentRuntimeConfig?: (agent: AgentRecord) => Promise<void>;
}

export type AgentRunStateMap = Map<string, AgentRunState>;
