import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@nerve/agent";
import type {
  AgentRecord,
  ConversationEntry,
  PlanReviewRecord,
  ToolCallRecord,
  UserQuestionRecord,
} from "@nerve/shared";
import { agentMessageText } from "../../agent-runner/index.js";
import type { AgentSuspensionService } from "../../agent-suspension-service.js";
import { completedToolResult } from "../../agent-tool-adapter.js";
import type { HarnessManager } from "../../harness-manager.js";
import { HttpError } from "../../http/errors.js";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { PlanService } from "../../plan-service.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../registry/types.js";
import type { ToolService } from "../../tool-service.js";

export interface HumanInputResolutionDeps {
  events: EventBus;
  tools: ToolService;
  plans: PlanService;
  suspensions: AgentSuspensionService;
  continueAgent(agentId: string): Promise<void>;
  getAgent(agentId: string): AgentRecord;
  setAgentStatus(
    agent: AgentRecord,
    status: AgentRecord["status"],
  ): Promise<void>;
  appendEntry(
    input: AppendEntryInput,
    options?: AppendEntryOptions,
  ): Promise<ConversationEntry>;
  harnessManager: HarnessManager;
}

export class HumanInputResolutionService {
  constructor(private readonly deps: HumanInputResolutionDeps) {}

  async acceptPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    try {
      const review = await this.deps.plans.acceptPlanReview(reviewId, feedback);
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        {
          continueAgent: true,
          followUpUserMessage: acceptedPlanFollowUp(review.planPath),
          finalSuspensionStatus: "resumed",
        },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async rejectPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    try {
      const review = await this.deps.plans.rejectPlanReview(reviewId, feedback);
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        {
          continueAgent: false,
          finalSuspensionStatus: "cancelled",
        },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async requestPlanChanges(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    try {
      const review = await this.deps.plans.requestPlanChanges(
        reviewId,
        feedback,
      );
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async discardPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    try {
      const review = await this.deps.plans.discardPlanReview(
        reviewId,
        feedback,
      );
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return review;
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
  ): Promise<UserQuestionRecord> {
    try {
      const question = await this.deps.tools.answerUserQuestion(
        questionId,
        answer,
      );
      await this.resolveSuspensionForToolCall(
        question.toolCallId,
        this.deps.tools.userQuestionResult(question),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return question;
    } catch (error) {
      throw new HttpError(
        404,
        "USER_QUESTION_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async dismissUserQuestion(
    questionId: string,
    reason?: string,
  ): Promise<UserQuestionRecord> {
    try {
      const question = await this.deps.tools.dismissUserQuestion(
        questionId,
        reason,
      );
      await this.resolveSuspensionForToolCall(
        question.toolCallId,
        this.deps.tools.userQuestionResult(question),
        { continueAgent: true, finalSuspensionStatus: "resumed" },
      );
      return question;
    } catch (error) {
      throw new HttpError(
        404,
        "USER_QUESTION_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async resolveSuspensionForToolCall(
    toolCallId: string,
    result: unknown,
    options: {
      continueAgent: boolean;
      followUpUserMessage?: string;
      finalSuspensionStatus: "resumed" | "cancelled";
    },
  ): Promise<void> {
    const toolCall = this.deps.tools.getToolCall(toolCallId);
    const suspension =
      this.deps.suspensions.pendingForToolCall(toolCallId) ??
      (toolCall.runId
        ? await this.waitForSuspensionForToolCall(toolCallId, 1500)
        : undefined);
    if (!suspension) {
      if (toolCall.status === "waiting_for_user") {
        await this.deps.tools.completeToolCall(toolCallId, result);
      }
      return;
    }
    await this.deps.suspensions.updateSuspension(suspension.id, {
      status: "resuming",
    });
    const completed = await this.deps.tools.completeToolCall(
      toolCallId,
      result,
    );
    const toolResultEntry = await this.appendToolResultForToolCall(
      completed,
      false,
    );
    await this.publishConversationEntryAppended(toolResultEntry);
    for (const remaining of suspension.remainingToolCalls) {
      const skippedEntry = await this.appendSkippedToolResult(
        suspension.agentId,
        remaining,
      );
      await this.publishConversationEntryAppended(skippedEntry);
    }
    if (options.followUpUserMessage) {
      const instructionEntry = await this.appendUserInstructionForAgent(
        suspension.agentId,
        options.followUpUserMessage,
        { runId: suspension.runId, turnId: suspension.turnId },
      );
      await this.publishConversationEntryAppended(instructionEntry);
    }
    await this.deps.suspensions.updateSuspension(suspension.id, {
      status: options.finalSuspensionStatus,
      resolvedAt: new Date().toISOString(),
    });
    if (options.continueAgent) {
      await this.deps.continueAgent(suspension.agentId);
      return;
    }
    const latest = this.safeGetAgent(suspension.agentId);
    if (latest) await this.deps.setAgentStatus(latest, "idle");
  }

  private async waitForSuspensionForToolCall(
    toolCallId: string,
    timeoutMs: number,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const suspension = this.deps.suspensions.pendingForToolCall(toolCallId);
      if (suspension) return suspension;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.deps.suspensions.pendingForToolCall(toolCallId);
  }

  private async appendUserInstructionForAgent(
    agentId: string,
    text: string,
    metadata: { runId?: string; turnId?: string } = {},
  ): Promise<ConversationEntry> {
    const agent = this.deps.getAgent(agentId);
    const message: AgentMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const appended = await this.deps.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.deps.appendEntry(
      {
        id: appended.id,
        conversationId: agent.conversationId,
        agentId: agent.id,
        runId: metadata.runId,
        turnId: metadata.turnId,
        role: "user",
        text,
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }

  private async appendToolResultForToolCall(
    toolCall: ToolCallRecord,
    isError: boolean,
  ): Promise<ConversationEntry> {
    const agent = this.deps.getAgent(toolCall.agentId);
    const result = completedToolResult(toolCall);
    const providerToolCallId =
      toolCall.providerToolCallId ?? toolCall.sourceToolCallId ?? toolCall.id;
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: providerToolCallId,
      toolName: toolCall.toolName,
      content: result.content,
      details: result.details,
      isError,
      timestamp: Date.now(),
    };
    const appended = await this.deps.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.deps.appendEntry(
      {
        id: appended.id,
        conversationId: toolCall.conversationId,
        agentId: toolCall.agentId,
        runId: toolCall.runId,
        turnId: toolCall.turnId,
        role: "system",
        text: agentMessageText(message),
        details: {
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          toolRecordId: toolCall.id,
          details: message.details,
        },
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }

  private async appendSkippedToolResult(
    agentId: string,
    remaining: { id: string; name: string },
  ): Promise<ConversationEntry> {
    const agent = this.deps.getAgent(agentId);
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: remaining.id,
      toolName: remaining.name,
      content: [
        {
          type: "text",
          text: "Tool call was not executed because the agent suspended for user input. Re-issue this tool call if it is still needed after the user response.",
        },
      ],
      details: { skippedForHumanInput: true },
      isError: true,
      timestamp: Date.now(),
    };
    const appended = await this.deps.harnessManager.appendAgentMessage(
      agent,
      message,
    );
    return this.deps.appendEntry(
      {
        id: appended.id,
        conversationId: agent.conversationId,
        agentId: agent.id,
        role: "system",
        text: agentMessageText(message),
        details: {
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          details: message.details,
        },
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }

  private async publishConversationEntryAppended(
    entry: ConversationEntry,
  ): Promise<void> {
    await this.deps.events.publish("conversation.entry.appended", {
      conversationId: entry.conversationId,
      agentId: entry.agentId,
      runId: entry.runId,
      turnId: entry.turnId,
      liveMessageId: entry.liveMessageId,
      entry,
    });
  }

  private safeGetAgent(agentId: string): AgentRecord | undefined {
    try {
      return this.deps.getAgent(agentId);
    } catch {
      return undefined;
    }
  }
}

function acceptedPlanFollowUp(planPath: string): string {
  return `The user accepted the plan at ${planPath}. Proceed with the implementation using that plan as the source of truth.`;
}
