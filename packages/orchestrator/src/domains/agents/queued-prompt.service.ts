import type { AgentRecord, QueuedPromptRecord } from "@nerve/shared";
import type { ConversationRuntime } from "../conversations/conversation-runtime.js";
import { HttpError } from "../../http/errors.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { PromptQueueRepository } from "./prompt-queue.repository.js";

export interface QueuedPromptServiceDeps {
  promptQueueRepository: PromptQueueRepository;
  conversationRuntime: ConversationRuntime;
  events: EventBus;
  getAgent(agentId: string): AgentRecord;
}

export class QueuedPromptService {
  constructor(private readonly deps: QueuedPromptServiceDeps) {}

  async listQueuedPrompts(agentId: string): Promise<QueuedPromptRecord[]> {
    this.deps.getAgent(agentId);
    return this.deps.promptQueueRepository.pendingForAgent(agentId);
  }

  async cancelQueuedPrompt(
    agentId: string,
    queuedPromptId: string,
  ): Promise<QueuedPromptRecord> {
    const agent = this.deps.getAgent(agentId);
    const cancelled = await this.deps.promptQueueRepository.cancel(
      queuedPromptId,
      agentId,
    );
    if (!cancelled) {
      throw new HttpError(
        404,
        "QUEUED_PROMPT_NOT_FOUND",
        "Queued prompt not found.",
      );
    }
    if (cancelled.status === "cancelled") {
      this.deps.conversationRuntime.removeQueuedPrompt(
        cancelled.runId,
        cancelled.id,
      );
      await this.deps.events.publish("conversation.prompt.cancelled", {
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        runId: cancelled.runId,
        queuedPrompt: cancelled,
      });
    }
    return cancelled;
  }
}
