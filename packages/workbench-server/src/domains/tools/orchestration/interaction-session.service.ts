import type { ToolCallRecord, UserQuestionRecord } from "@nervekit/contracts";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import { optionalStringArg, stringArg } from "../execution/tool-arguments.js";
import { ToolExecutionSuspended } from "../execution/tool-execution-suspension.js";
import type { ToolRequestOptions } from "../execution/tool-service.js";

export interface InteractionSessionDeps {
  events: StreamLogRegistry;
  getToolCall(toolCallId: string): ToolCallRecord;
  listToolCalls(): ToolCallRecord[];
  updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord>;
  publishToolCallUpdated(toolCall: ToolCallRecord): Promise<void>;
}

export class InteractionSessionService {
  private readonly waiters = new Map<
    string,
    Set<(question: UserQuestionRecord) => void>
  >();
  private readonly questions = new Map<
    string,
    { toolCallId: string; ordinal: number }
  >();
  private questionsHydrated = false;
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
        await this.wait(existing.id, options.signal),
      );
    }
    const now = new Date().toISOString();
    const ordinal = toolCall.interactions.length;
    const waitingToolCall = await this.deps.updateToolCall(toolCall.id, {
      status: "waiting",
      interactions: [
        ...toolCall.interactions,
        {
          ordinal,
          kind: "user_input",
          status: "pending",
          requestedAt: now,
          updatedAt: now,
          request: {
            question: stringArg(args, "question"),
            context: optionalStringArg(args.context),
            recommendation: optionalStringArg(args.recommendation),
            required: true,
          },
        },
      ],
    });
    const question = projectQuestion(waitingToolCall, ordinal);
    this.questions.set(question.id, {
      toolCallId: waitingToolCall.id,
      ordinal,
    });
    await this.deps.publishToolCallUpdated(waitingToolCall);
    if (options.durableSuspend) throw new ToolExecutionSuspended();
    return this.userQuestionResult(
      await this.wait(question.id, options.signal),
    );
  }

  answerUserQuestion(
    questionId: string,
    answer: string,
    resolutionRequestId?: string,
  ): Promise<UserQuestionRecord> {
    return this.resolve(
      questionId,
      { action: "answer", answer },
      resolutionRequestId,
    );
  }

  dismissUserQuestion(
    questionId: string,
    reason?: string,
    resolutionRequestId?: string,
  ): Promise<UserQuestionRecord> {
    return this.resolve(
      questionId,
      {
        action: "dismiss",
        reason: reason ?? "Dismissed by user.",
      },
      resolutionRequestId,
    );
  }

  resolvedUserQuestion(
    toolCallId: string,
  ): Record<string, unknown> | undefined {
    const question = this.questionForToolCall(toolCallId);
    return question && question.status !== "pending"
      ? this.userQuestionResult(question)
      : undefined;
  }

  userQuestionResult(question: UserQuestionRecord): Record<string, unknown> {
    return {
      question: question.question,
      questionId: question.id,
      interactionOrdinal: this.questions.get(question.id)?.ordinal,
      context: question.context,
      recommendation: question.recommendation,
      response: question.answer,
      dismissed: question.status === "dismissed",
      dismissedReason: question.dismissedReason,
    };
  }

  private async resolve(
    questionId: string,
    resolution:
      | { action: "answer"; answer: string }
      | { action: "dismiss"; reason: string },
    resolutionRequestId?: string,
  ): Promise<UserQuestionRecord> {
    const found = this.find(questionId);
    if (!found || found.question.status !== "pending")
      throw new Error("User question is not pending.");
    const now = new Date().toISOString();
    const interactions = found.toolCall.interactions.map((interaction) =>
      interaction.ordinal === found.ordinal && interaction.kind === "user_input"
        ? {
            ...interaction,
            status: "resolved" as const,
            updatedAt: now,
            resolvedAt: now,
            resolutionRequestId,
            resolution,
          }
        : interaction,
    );
    const updatedToolCall = await this.deps.updateToolCall(found.toolCall.id, {
      interactions,
      status: "running",
    });
    const question = projectQuestion(updatedToolCall, found.ordinal);
    this.questions.delete(questionId);
    await this.deps.publishToolCallUpdated(updatedToolCall);
    this.notify(question);
    return question;
  }

  private questionForToolCall(
    toolCallId: string,
  ): UserQuestionRecord | undefined {
    const toolCall = this.deps.getToolCall(toolCallId);
    const interaction = toolCall.interactions.find(
      (item) => item.kind === "user_input",
    );
    return interaction
      ? projectQuestion(toolCall, interaction.ordinal)
      : undefined;
  }

  private find(questionId: string):
    | {
        toolCall: ToolCallRecord;
        ordinal: number;
        question: UserQuestionRecord;
      }
    | undefined {
    if (!this.questionsHydrated) this.hydrateQuestionIndex();
    const indexed = this.questions.get(questionId);
    if (!indexed) return undefined;
    const toolCall = this.deps.getToolCall(indexed.toolCallId);
    const interaction = toolCall.interactions[indexed.ordinal];
    if (!interaction || interaction.kind !== "user_input") {
      this.questions.delete(questionId);
      return undefined;
    }
    return {
      toolCall,
      ordinal: indexed.ordinal,
      question: projectQuestion(toolCall, indexed.ordinal),
    };
  }

  private hydrateQuestionIndex(): void {
    this.questionsHydrated = true;
    for (const toolCall of this.deps.listToolCalls()) {
      for (const interaction of toolCall.interactions) {
        if (
          interaction.kind !== "user_input" ||
          interaction.status !== "pending"
        ) {
          continue;
        }
        const question = projectQuestion(toolCall, interaction.ordinal);
        this.questions.set(question.id, {
          toolCallId: toolCall.id,
          ordinal: interaction.ordinal,
        });
      }
    }
  }

  private wait(
    questionId: string,
    signal?: AbortSignal,
  ): Promise<UserQuestionRecord> {
    if (signal?.aborted)
      void this.dismissUserQuestion(questionId, "Agent run aborted.").catch(
        () => undefined,
      );
    return new Promise((resolve) => {
      const settle = (question: UserQuestionRecord) => {
        cleanup();
        resolve(question);
      };
      const onAbort = () =>
        void this.dismissUserQuestion(questionId, "Agent run aborted.").catch(
          () => undefined,
        );
      const cleanup = () => {
        const waiters = this.waiters.get(questionId);
        waiters?.delete(settle);
        if (waiters?.size === 0) this.waiters.delete(questionId);
        signal?.removeEventListener("abort", onAbort);
      };
      const found = this.find(questionId);
      if (found && found.question.status !== "pending") {
        resolve(found.question);
        return;
      }
      const waiters = this.waiters.get(questionId) ?? new Set();
      waiters.add(settle);
      this.waiters.set(questionId, waiters);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private notify(question: UserQuestionRecord): void {
    const waiters = this.waiters.get(question.id);
    if (!waiters) return;
    this.waiters.delete(question.id);
    for (const waiter of waiters) waiter(question);
  }
}

function projectQuestion(
  toolCall: ToolCallRecord,
  ordinal: number,
): UserQuestionRecord {
  const interaction = toolCall.interactions[ordinal];
  if (!interaction || interaction.kind !== "user_input")
    throw new Error("User-input interaction not found.");
  return {
    id: `question_${toolCall.id}_${ordinal}`,
    toolCallId: toolCall.id,
    agentId: toolCall.agentId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    question: interaction.request.question,
    context: interaction.request.context,
    recommendation: interaction.request.recommendation,
    status:
      interaction.status === "pending"
        ? "pending"
        : interaction.resolution?.action === "answer"
          ? "answered"
          : "dismissed",
    answer:
      interaction.resolution?.action === "answer"
        ? interaction.resolution.answer
        : undefined,
    dismissedReason:
      interaction.resolution?.action === "dismiss"
        ? interaction.resolution.reason
        : undefined,
    requestedAt: interaction.requestedAt,
    resolvedAt: interaction.resolvedAt,
    updatedAt: interaction.updatedAt,
  };
}
