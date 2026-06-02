import type { Message } from "@earendil-works/pi-ai";
import type { PromptRequest } from "@nerve/shared";

export interface AgentRunState {
  runId: string;
  abort: () => void;
  messages: Message[];
  steer?: (text: string, options?: PromptRequest) => Promise<void>;
  followUp?: (text: string, options?: PromptRequest) => Promise<void>;
}

export type AgentRunStateMap = Map<string, AgentRunState>;
