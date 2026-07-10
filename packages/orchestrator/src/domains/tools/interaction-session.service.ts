import type { ToolCallRecord, UserQuestionRecord } from "@nervekit/contracts";
import { createId } from "@nervekit/contracts";
import type { EventBus } from "../../infrastructure/events/index.js";
import { optionalStringArg, stringArg } from "./tool-args.js";
import { ToolExecutionSuspended } from "./tool-execution-suspension.js";
import type { ToolRequestOptions } from "./tool-service.js";
import type { UserQuestionRepository } from "./user-question.repository.js";

export interface InteractionSessionDeps {
  userQuestionRepository: UserQuestionRepository;
  events: EventBus;
  updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord>;
  publishToolCallUpdated(toolCall: ToolCallRecord): Promise<void>;
}

export class InteractionSessionService {
  private readonly userQuestionWaiters = new Map<
    string,
    Set<(question: UserQuestionRecord) => void>
  >();

  constructor(private readonly deps: InteractionSessionDeps) {}

  async requestUserQuestion(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<unknown> {
    const existing = this.questionForToolCall(toolCall.id);
    if (existing) {
      if (existing.status !== "pending")
        return this.userQuestionResult(existing);
      if (options.durableSuspend) throw new ToolExecutionSuspended();
      return this.userQuestionResult(
        await this.waitForUserQuestion(existing.id, options.signal),
      );
    }
    const now = new Date().toISOString();
    const question: UserQuestionRecord = {
      id: createId("question"),
      toolCallId: toolCall.id,
      agentId: toolCall.agentId,
      conversationId: toolCall.conversationId,
      projectId: toolCall.projectId,
      question: stringArg(args, "question"),
      context: optionalStringArg(args.context),
      recommendation: optionalStringArg(args.recommendation),
      placeholder: optionalStringArg(args.placeholder),
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    await this.deps.userQuestionRepository.upsert(question);
    const waitingToolCall = await this.deps.updateToolCall(toolCall.id, {
      status: "waiting_for_user",
    });
    await this.deps.publishToolCallUpdated(waitingToolCall);
    await this.deps.events.publish("user_question.requested", {
      question,
      toolCall: waitingToolCall,
    });

    if (options.durableSuspend) throw new ToolExecutionSuspended();
    const resolved = await this.waitForUserQuestion(
      question.id,
      options.signal,
    );
    return this.userQuestionResult(resolved);
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
  ): Promise<UserQuestionRecord> {
    const question = this.getPendingUserQuestion(questionId);
    const updated: UserQuestionRecord = {
      ...question,
      status: "answered",
      answer,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.deps.userQuestionRepository.upsert(updated);
    await this.deps.events.publish("user_question.answered", {
      question: updated,
    });
    this.notifyUserQuestionWaiters(updated);
    return updated;
  }

  async dismissUserQuestion(
    questionId: string,
    reason?: string,
  ): Promise<UserQuestionRecord> {
    const question = this.getPendingUserQuestion(questionId);
    const updated: UserQuestionRecord = {
      ...question,
      status: "dismissed",
      dismissedReason: reason ?? "Dismissed by user.",
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.deps.userQuestionRepository.upsert(updated);
    await this.deps.events.publish("user_question.dismissed", {
      question: updated,
    });
    this.notifyUserQuestionWaiters(updated);
    return updated;
  }

  resolvedUserQuestion(
    toolCallId: string,
  ): Record<string, unknown> | undefined {
    const question = this.questionForToolCall(toolCallId);
    return question && question.status !== "pending"
      ? this.userQuestionResult(question)
      : undefined;
  }

  private questionForToolCall(
    toolCallId: string,
  ): UserQuestionRecord | undefined {
    return this.deps.userQuestionRepository
      .list()
      .find((question) => question.toolCallId === toolCallId);
  }

  userQuestionResult(question: UserQuestionRecord): Record<string, unknown> {
    return {
      question: question.question,
      context: question.context,
      recommendation: question.recommendation,
      response: question.answer,
      dismissed: question.status === "dismissed",
      dismissedReason: question.dismissedReason,
    };
  }

  private getPendingUserQuestion(questionId: string): UserQuestionRecord {
    return this.deps.userQuestionRepository.getPending(questionId);
  }

  private waitForUserQuestion(
    questionId: string,
    signal?: AbortSignal,
  ): Promise<UserQuestionRecord> {
    if (signal?.aborted) {
      void this.dismissUserQuestion(questionId, "Agent run aborted.").catch(
        () => undefined,
      );
    }

    return new Promise<UserQuestionRecord>((resolve) => {
      const settle = (question: UserQuestionRecord) => {
        if (question.status === "pending") return;
        cleanup();
        resolve(question);
      };
      const onAbort = () => {
        void this.dismissUserQuestion(questionId, "Agent run aborted.").catch(
          () => undefined,
        );
      };
      const cleanup = () => {
        const waiters = this.userQuestionWaiters.get(questionId);
        waiters?.delete(settle);
        if (waiters && waiters.size === 0) {
          this.userQuestionWaiters.delete(questionId);
        }
        signal?.removeEventListener("abort", onAbort);
      };

      const current = this.deps.userQuestionRepository.get(questionId);
      if (current && current.status !== "pending") {
        resolve(current);
        return;
      }

      let waiters = this.userQuestionWaiters.get(questionId);
      if (!waiters) {
        waiters = new Set();
        this.userQuestionWaiters.set(questionId, waiters);
      }
      waiters.add(settle);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private notifyUserQuestionWaiters(question: UserQuestionRecord): void {
    const waiters = this.userQuestionWaiters.get(question.id);
    if (!waiters) return;
    this.userQuestionWaiters.delete(question.id);
    for (const waiter of waiters) waiter(question);
  }
}
