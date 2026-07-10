import type { QueuedPromptRecord } from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { PromptQueueRepository } from "./prompt-queue.repository.js";

export interface QueuedPromptServiceDeps {
  promptQueueRepository: PromptQueueRepository;
  state: RuntimeState;
  events: EventBus;
}

export class QueuedPromptService {
  constructor(private readonly deps: QueuedPromptServiceDeps) {}

  async listQueuedPrompts(agentId: string): Promise<QueuedPromptRecord[]> {
    this.deps.state.getAgent(agentId);
    return this.deps.promptQueueRepository.pendingForAgent(agentId);
  }

  async cancelQueuedPrompt(
    agentId: string,
    queuedPromptId: string,
  ): Promise<QueuedPromptRecord> {
    const agent = this.deps.state.getAgent(agentId);
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
      await this.deps.state.runs
        .get(agent.id)
        ?.removeQueuedPrompt?.(cancelled.id);
      this.deps.state.conversationRuntime.removeQueuedPrompt(
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
