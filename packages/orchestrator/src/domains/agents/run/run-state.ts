import type { Message } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@nervekit/agent-runtime";
import type { AgentRecord, PromptRequest } from "@nervekit/contracts";

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
  removeQueuedPrompt?: (queuedPromptId: string) => Promise<boolean>;
  updateAgentRuntimeConfig?: (agent: AgentRecord) => Promise<void>;
  appendExternalMessage?: (input: {
    id: string;
    message: AgentMessage;
    timestamp: string;
  }) => Promise<void>;
  enqueueHarnessMessage?: (input: {
    id: string;
    message: AgentMessage;
    timestamp: string;
    delivery?: {
      taskId?: string;
      event?: string;
      pendingNotificationId?: string;
    };
  }) => Promise<void>;
}

export type AgentRunStateMap = Map<string, AgentRunState>;
