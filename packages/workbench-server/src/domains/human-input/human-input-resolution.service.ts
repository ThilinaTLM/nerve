import { createHash } from "node:crypto";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@nervekit/host-runtime/harness";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
  CreateAgentRequest,
  CreateConversationRequest,
  PlanImplementationSelection,
  PlanReviewRecord,
  ToolCallRecord,
  UpdateAgentRequest,
  UserQuestionRecord,
} from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../runtime/types.js";
import type { WorkbenchRunService } from "../runs/workbench-run.service.js";
import { agentMessageText } from "../agents/run/index.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
import type { PlanService } from "../plans/plan-service.js";
import { toolCallResultForModel } from "../tools/agent-tool-adapter.js";
import type { ToolService } from "../tools/tool-service.js";
import { toToolCallTranscriptRecord } from "../tools/tool-call-transcript-preview.js";
import { ApprovalBatchResolutionService } from "./approval-batch-resolution.js";

export type AcceptPlanReviewInNewChatResult = {
  planReview: PlanReviewRecord;
  conversation: ConversationRecord;
  agent: AgentRecord;
};

export interface HumanInputResolutionDeps {
  tools: ToolService;
  plans: PlanService;
  runs: WorkbenchRunService;
  continueAgent(agentId: string): Promise<void>;
  createConversation(
    request: CreateConversationRequest,
  ): Promise<ConversationRecord>;
  createAgent(request: CreateAgentRequest): Promise<AgentRecord>;
  getAgent(agentId: string): AgentRecord;
  configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
  ): Promise<AgentRecord>;
  setAgentStatus(
    agent: AgentRecord,
    status: AgentRecord["status"],
  ): Promise<void>;
  appendEntry(
    input: AppendEntryInput,
    options?: AppendEntryOptions,
  ): Promise<ConversationEntry>;
  getConversationEntries(conversationId: string): ConversationEntry[];
  harnessStorage: ConversationHarnessStorage;
}

export class HumanInputResolutionService {
  private readonly approvalBatches: ApprovalBatchResolutionService;

  constructor(private readonly deps: HumanInputResolutionDeps) {
    this.approvalBatches = new ApprovalBatchResolutionService({
      tools: deps.tools,
      runs: deps.runs,
      appendToolResult: (toolCall, isError) =>
        this.appendToolResultForToolCall(toolCall, isError),
      existingToolResultEntry: (toolCall) =>
        deps.getConversationEntries(toolCall.conversationId).find((entry) => {
          if (!entry.details || typeof entry.details !== "object") return false;
          return (
            (entry.details as { toolRecordId?: unknown }).toolRecordId ===
            toolCall.id
          );
        }),
    });
  }

  async acceptPlanReview(
    reviewId: string,
    feedback?: string,
    implementation?: PlanImplementationSelection,
  ): Promise<PlanReviewRecord> {
    const pendingReview = this.getPendingPlanReviewOrThrow(reviewId);
    const source = await this.planReviewSource(pendingReview);
    await this.applyImplementationSelectionToSourceAgent(
      pendingReview.agentId,
      implementation,
    );

    let review: PlanReviewRecord;
    try {
      review = await this.deps.plans.acceptPlanReview(reviewId, feedback);
    } catch (error) {
      throw this.planReviewNotFound(error);
    }

    if (source.state === "terminal") {
      await this.reconcileTerminalPlanReview(review);
      await this.startAcceptedPlanImplementation(review);
      return review;
    }

    try {
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        {
          continueAgent: true,
          followUpUserMessage: acceptedPlanFollowUp(review.planPath),
          finalSuspensionStatus: "resumed",
        },
      );
    } catch (error) {
      if (source.state === "detached") throw error;
      const latest = await this.planReviewSource(review);
      if (latest.state !== "terminal") throw error;
      await this.reconcileTerminalPlanReview(review);
      await this.startAcceptedPlanImplementation(review);
    }
    return review;
  }

  async acceptPlanReviewInNewChat(
    reviewId: string,
    feedback?: string,
    implementation?: PlanImplementationSelection,
  ): Promise<AcceptPlanReviewInNewChatResult> {
    const pendingReview = this.getPendingPlanReviewOrThrow(reviewId);
    const source = await this.planReviewSource(pendingReview);
    const sourceAgent = this.deps.getAgent(pendingReview.agentId);
    const conversation = await this.deps.createConversation({
      projectId: pendingReview.projectId,
      title: implementationConversationTitle(pendingReview),
      mode: "coding",
      permissionLevel: sourceAgent.permissionLevel,
    });
    const agent = await this.deps.createAgent({
      projectId: pendingReview.projectId,
      conversationId: conversation.id,
      projectDir: sourceAgent.projectDir,
      workerId: sourceAgent.workerId,
      mode: "coding",
      permissionLevel: sourceAgent.permissionLevel,
      workspaceScope: sourceAgent.workspaceScope,
      model: implementation?.implementationModel ?? sourceAgent.model,
      thinkingLevel:
        implementation?.implementationThinkingLevel ??
        sourceAgent.thinkingLevel,
    });
    let review: PlanReviewRecord;
    try {
      review = await this.deps.plans.acceptPlanReviewInNewChat(
        reviewId,
        feedback,
      );
    } catch (error) {
      throw this.planReviewNotFound(error);
    }
    if (source.state === "terminal") {
      await this.reconcileTerminalPlanReview(review);
    } else {
      try {
        await this.resolveSuspensionForToolCall(
          review.toolCallId,
          this.deps.plans.planReviewResult(review),
          {
            continueAgent: false,
            completeRun: true,
            finalSuspensionStatus: "cancelled",
          },
        );
      } catch (error) {
        if (source.state === "detached") throw error;
        const latest = await this.planReviewSource(review);
        if (latest.state !== "terminal") throw error;
        await this.reconcileTerminalPlanReview(review);
      }
    }
    await this.deps.runs.promptAgent(agent.id, {
      text: acceptedPlanInNewChatInstruction(pendingReview.planPath),
    });
    return { planReview: review, conversation, agent };
  }

  async rejectPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const rejectableReview = this.getRejectablePlanReviewOrThrow(reviewId);
    let review: PlanReviewRecord;
    try {
      review = await this.deps.plans.rejectPlanReview(reviewId, feedback);
    } catch (error) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        error instanceof Error ? error.message : String(error),
      );
    }

    const source = await this.planReviewSource(rejectableReview);
    if (source.state === "detached") {
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        {
          continueAgent: false,
          completeRun: true,
          finalSuspensionStatus: "cancelled",
        },
      );
      await this.setRejectedPlanAgentIdle(review);
      return review;
    }

    if (source.state === "terminal") {
      await this.reconcileTerminalPlanReview(review);
      await this.setRejectedPlanAgentIdle(review);
      return review;
    }

    try {
      await this.resolveSuspensionForToolCall(
        review.toolCallId,
        this.deps.plans.planReviewResult(review),
        {
          continueAgent: false,
          completeRun: true,
          finalSuspensionStatus: "cancelled",
        },
      );
    } catch (error) {
      const latest = await this.planReviewSource(review);
      if (latest.state !== "terminal") throw error;
      await this.reconcileTerminalPlanReview(review);
    }
    await this.setRejectedPlanAgentIdle(review);
    return review;
  }

  async requestPlanChanges(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const pendingReview = this.getPendingPlanReviewOrThrow(reviewId);
    await this.deps.runs.assertPendingInteractionForToolCall(
      pendingReview.toolCallId,
      this.deps.tools.getToolCall(pendingReview.toolCallId).runId,
    );
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
    const pendingReview = this.getPendingPlanReviewOrThrow(reviewId);
    await this.deps.runs.assertPendingInteractionForToolCall(
      pendingReview.toolCallId,
      this.deps.tools.getToolCall(pendingReview.toolCallId).runId,
    );
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

  resolveApproval(
    approvalId: string,
    decision: "allow" | "deny",
    note?: string,
  ): Promise<ToolCallRecord> {
    return this.approvalBatches.resolve(approvalId, decision, note);
  }

  recoverReadyApprovalBatches(): Promise<void> {
    return this.approvalBatches.recoverReadyBatches();
  }

  async recoverAcceptedPlanReviews(): Promise<void> {
    const reviews = this.deps.plans
      .listPlanReviews()
      .filter((review) => review.status === "accepted");
    for (const review of reviews) {
      const toolCall = this.deps.tools.getToolCall(review.toolCallId);
      if (
        toolCall.toolName !== "plan_mode_present" ||
        toolCall.status !== "waiting_for_user"
      ) {
        continue;
      }
      const source = await this.planReviewSource(review);
      if (source.state === "pending") {
        try {
          await this.resolveSuspensionForToolCall(
            review.toolCallId,
            this.deps.plans.planReviewResult(review),
            {
              continueAgent: true,
              followUpUserMessage: acceptedPlanFollowUp(review.planPath),
              finalSuspensionStatus: "resumed",
            },
          );
          continue;
        } catch (error) {
          const latest = await this.planReviewSource(review);
          if (latest.state !== "terminal") throw error;
        }
      }
      await this.reconcileTerminalPlanReview(review);
      await this.startAcceptedPlanImplementation(review);
    }
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
  ): Promise<UserQuestionRecord> {
    const pendingQuestion = this.pendingQuestion(questionId);
    if (pendingQuestion.runId) {
      await this.deps.runs.assertPendingInteractionForToolCall(
        pendingQuestion.toolCallId,
        pendingQuestion.runId,
      );
    }
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
    const pendingQuestion = this.pendingQuestion(questionId);
    if (pendingQuestion.runId) {
      await this.deps.runs.assertPendingInteractionForToolCall(
        pendingQuestion.toolCallId,
        pendingQuestion.runId,
      );
    }
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

  private pendingQuestion(questionId: string): UserQuestionRecord & {
    runId?: string;
  } {
    const question = this.deps.tools
      .listUserQuestions()
      .find((candidate) => candidate.id === questionId);
    if (!question || question.status !== "pending") {
      throw new HttpError(
        404,
        "USER_QUESTION_NOT_FOUND",
        "User question is not pending.",
      );
    }
    const toolCall = this.deps.tools.getToolCall(question.toolCallId);
    return { ...question, runId: toolCall.runId };
  }

  private getPendingPlanReviewOrThrow(reviewId: string): PlanReviewRecord {
    const review = this.getPlanReviewOrThrow(reviewId);
    if (review.status !== "pending") {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        "Plan review is already resolved.",
      );
    }
    return review;
  }

  private getRejectablePlanReviewOrThrow(reviewId: string): PlanReviewRecord {
    const review = this.getPlanReviewOrThrow(reviewId);
    if (review.status !== "pending" && review.status !== "changes_requested") {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        "Plan review is already resolved.",
      );
    }
    return review;
  }

  private getPlanReviewOrThrow(reviewId: string): PlanReviewRecord {
    const review = this.deps.plans
      .listPlanReviews()
      .find((candidate) => candidate.id === reviewId);
    if (!review) {
      throw new HttpError(
        404,
        "PLAN_REVIEW_NOT_FOUND",
        "Plan review not found.",
      );
    }
    return review;
  }

  private async planReviewSource(review: PlanReviewRecord): Promise<{
    state: "detached" | "pending" | "terminal";
    toolCall: ToolCallRecord;
  }> {
    const toolCall = this.deps.tools.getToolCall(review.toolCallId);
    if (!toolCall.runId) return { state: "detached", toolCall };
    const state = await this.deps.runs.interactionResolutionStateForToolCall(
      toolCall.id,
      toolCall.runId,
    );
    return { state, toolCall };
  }

  private planReviewNotFound(error: unknown): HttpError {
    return new HttpError(
      404,
      "PLAN_REVIEW_NOT_FOUND",
      error instanceof Error ? error.message : String(error),
    );
  }

  private async applyImplementationSelectionToSourceAgent(
    agentId: string,
    implementation?: PlanImplementationSelection,
  ): Promise<void> {
    const implementationModel = implementation?.implementationModel;
    const implementationThinkingLevel =
      implementation?.implementationThinkingLevel;
    if (
      implementationModel === undefined &&
      implementationThinkingLevel === undefined
    ) {
      return;
    }

    if (implementationModel) {
      const sourceAgent = this.deps.getAgent(agentId);
      await this.deps.configureAgent(agentId, {
        model: implementationModel,
        thinkingLevel: implementationThinkingLevel ?? sourceAgent.thinkingLevel,
      });
      return;
    }

    await this.deps.configureAgent(agentId, {
      thinkingLevel: implementationThinkingLevel,
    });
  }

  private async startAcceptedPlanImplementation(
    review: PlanReviewRecord,
  ): Promise<void> {
    await this.deps.runs.promptAgent(review.agentId, {
      text: acceptedPlanFollowUp(review.planPath),
    });
  }

  private async reconcileTerminalPlanReview(
    review: PlanReviewRecord,
  ): Promise<void> {
    const toolCall = this.deps.tools.getToolCall(review.toolCallId);
    if (toolCall.status === "completed") return;
    await this.deps.tools.resumeToolCall(review.toolCallId);
    const completed = await this.deps.tools.completeToolCall(
      review.toolCallId,
      this.deps.plans.planReviewResult(review),
    );
    if (!this.existingToolResultEntry(completed)) {
      await this.appendToolResultForToolCall(completed, false);
    }
  }

  private existingToolResultEntry(
    toolCall: ToolCallRecord,
  ): ConversationEntry | undefined {
    return this.deps
      .getConversationEntries(toolCall.conversationId)
      .find((entry) => {
        if (!entry.details || typeof entry.details !== "object") return false;
        return (
          (entry.details as { toolRecordId?: unknown }).toolRecordId ===
          toolCall.id
        );
      });
  }

  private async setRejectedPlanAgentIdle(
    review: PlanReviewRecord,
  ): Promise<void> {
    const agent = this.deps.getAgent(review.agentId);
    if (agent.status === "idle") return;
    await this.deps.setAgentStatus(agent, "idle");
  }

  private async resolveSuspensionForToolCall(
    toolCallId: string,
    result: unknown,
    options: {
      continueAgent: boolean;
      completeRun?: boolean;
      followUpUserMessage?: string;
      finalSuspensionStatus: "resumed" | "cancelled";
    },
  ): Promise<void> {
    const toolCall = this.deps.tools.getToolCall(toolCallId);
    const batch =
      toolCall.runId && toolCall.toolName === "ask_user"
        ? await this.deps.runs.interactionBatchForToolCall(
            toolCallId,
            toolCall.runId,
          )
        : undefined;
    await this.deps.tools.resumeToolCall(toolCallId);
    if (!toolCall.runId) {
      await this.deps.tools.completeToolCall(toolCallId, result);
      return;
    }
    const completed = await this.deps.tools.completeToolCall(
      toolCallId,
      result,
    );
    const hasPendingSibling = batch?.interactions.some(
      (interaction) =>
        interaction.toolCallId !== toolCallId &&
        interaction.status === "pending",
    );
    const orderedToolCalls = hasPendingSibling
      ? [completed]
      : (batch?.batchToolCallIds ?? [toolCallId]).map((id) =>
          this.deps.tools.getToolCall(id),
        );
    const entries: ConversationEntry[] = [];
    if (!hasPendingSibling) {
      for (const batchToolCall of orderedToolCalls) {
        const existing = batch
          ? this.existingToolResultEntry(batchToolCall)
          : undefined;
        entries.push(
          existing ??
            (await this.appendToolResultForToolCall(
              batchToolCall,
              batchToolCall.status !== "completed",
            )),
        );
      }
    }
    if (options.followUpUserMessage && !hasPendingSibling) {
      entries.push(
        await this.appendUserInstructionForAgent(
          completed.agentId,
          options.followUpUserMessage,
          { runId: completed.runId, turnId: completed.turnId },
        ),
      );
    }
    const resolution =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : { result };
    const resolutionRequestId = `resolution_${createHash("sha256")
      .update(`${toolCallId}:${JSON.stringify(resolution)}`)
      .digest("hex")
      .slice(0, 24)}`;
    await this.deps.runs.resolveInteractionForToolCall({
      toolCallId,
      runId: completed.runId,
      resolutionRequestId,
      resolution,
      entries,
      toolCalls: orderedToolCalls.map(toToolCallTranscriptRecord),
      continueRun: options.continueAgent,
      completeRun: options.completeRun,
    });
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
    const appended = await this.deps.harnessStorage.appendAgentMessage(
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
    const result = toolCallResultForModel(toolCall);
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
    const appended = await this.deps.harnessStorage.appendAgentMessage(
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
    const appended = await this.deps.harnessStorage.appendAgentMessage(
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

function acceptedPlanInNewChatInstruction(planPath: string): string {
  return `The user accepted the plan at ${planPath} and chose to implement it in this new chat. Read that plan file and implement it as the source of truth.`;
}

function implementationConversationTitle(review: PlanReviewRecord): string {
  return `Implement: ${review.title ?? review.slug}`;
}
