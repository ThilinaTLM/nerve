import type { ImageContent } from "@earendil-works/pi-ai";
import {
  buildConversationContext,
  computeContextUsage,
  deriveAutoCompactionPolicy,
  estimateTokens,
  getCompactionDecisionTokens,
  getModelContextWindow,
  shouldAutoCompact,
} from "@nervekit/host-runtime/harness";
import type { AgentRecord, ContextUsage } from "@nervekit/contracts";
import type { WorkbenchAgentMechanicsDeps } from "./workbench-agent-mechanics.js";

const MAX_AUTO_CONTINUATIONS_PER_RUN = 3;

export const AUTO_COMPACTION_CONTINUE_MESSAGE =
  "Context was compacted into the checkpoint above. Continue this task in the same run: read Work Remaining, Current Working State, and Continuation Plan first; do not repeat Work Completed. Execute the remaining steps, validate the result, and stop when the task is complete.";

export class AutoCompactionRunner {
  private readonly continuationCounts = new Map<string, number>();

  constructor(readonly deps: WorkbenchAgentMechanicsDeps) {}

  /** Compute compaction-aware context-window usage for a conversation. */
  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    const conversation = this.deps.state.getConversation(conversationId);
    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessStorage.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const agent = conversation.activeAgentId
      ? this.deps.state.agents.get(conversation.activeAgentId)
      : undefined;
    const contextWindow = getModelContextWindow(agent?.model);
    return computeContextUsage(messages, branch, contextWindow);
  }

  async publishContextUsage(
    conversationId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    const contextUsage = await this.getContextUsage(conversationId);
    await this.deps.events.publish("conversation.context.updated", {
      conversationId,
      agentId,
      runId,
      contextUsage,
    });
  }

  async maybeCompactBeforePrompt(input: {
    conversationId: string;
    agentId: string;
    runId: string;
    text: string;
    images?: ImageContent[];
  }): Promise<boolean> {
    const promptTokens = estimateTokens({
      role: "user",
      content: [{ type: "text", text: input.text }, ...(input.images ?? [])],
      timestamp: Date.now(),
    });
    return this.maybeCompact({
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      additionalTokens: promptTokens,
      instructions:
        "Preventive compaction before a pending user prompt reaches the selected model context limit.",
    });
  }

  async maybeCompactAtIteration(input: {
    conversationId: string;
    agentId: string;
    runId: string;
  }): Promise<boolean> {
    return this.maybeCompact({
      ...input,
      additionalTokens: 0,
      instructions:
        "Automatic compaction at an agent iteration boundary before the next provider request.",
    });
  }

  takeContinuation(runId: string): string | undefined {
    const count = this.continuationCounts.get(runId) ?? 0;
    if (count >= MAX_AUTO_CONTINUATIONS_PER_RUN) return undefined;
    this.continuationCounts.set(runId, count + 1);
    return AUTO_COMPACTION_CONTINUE_MESSAGE;
  }

  finishRun(runId: string): void {
    this.continuationCounts.delete(runId);
  }

  private async maybeCompact(input: {
    conversationId: string;
    agentId: string;
    runId: string;
    additionalTokens: number;
    instructions: string;
  }): Promise<boolean> {
    const settings = this.deps.storage.settings.compaction;
    if (!settings.auto) return false;
    const conversation = this.deps.state.getConversation(input.conversationId);
    const agent = this.resolveAgent(conversation.activeAgentId, input.agentId);
    const contextWindow = getModelContextWindow(agent?.model);
    const policy = deriveAutoCompactionPolicy(contextWindow, settings);
    if (!policy.enabled || contextWindow <= 0) return false;

    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessStorage.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const contextTokens =
      getCompactionDecisionTokens(messages, branch) + input.additionalTokens;
    if (!shouldAutoCompact(contextTokens, policy)) return false;

    try {
      await this.deps.compactionService.compactConversation(
        input.conversationId,
        { instructions: input.instructions },
        this.compactionOptions(
          policy,
          input.agentId,
          input.runId,
          contextTokens,
        ),
      );
      return true;
    } catch (error) {
      await this.deps.logger.warn("Automatic context compaction failed", {
        agentId: input.agentId,
        conversationId: input.conversationId,
        runId: input.runId,
        context: {
          contextTokens,
          thresholdTokens: policy.thresholdTokens,
          profile: policy.profile,
        },
        error,
      });
      return false;
    }
  }

  private resolveAgent(
    activeAgentId: string | undefined,
    selectedAgentId: string,
  ): AgentRecord | undefined {
    return (
      this.deps.state.agents.get(selectedAgentId) ??
      (activeAgentId ? this.deps.state.agents.get(activeAgentId) : undefined)
    );
  }

  private compactionOptions(
    policy: ReturnType<typeof deriveAutoCompactionPolicy>,
    agentId: string,
    runId: string,
    contextTokens: number,
  ) {
    return {
      reason: "threshold" as const,
      agentId,
      runId,
      contextWindow: policy.contextWindow,
      contextTokens,
      thresholdTokens: policy.thresholdTokens,
      triggerReserveTokens: policy.triggerReserveTokens,
      keepRecentTokens: policy.keepRecentTokens,
      summaryReserveTokens: policy.summaryReserveTokens,
      profile: policy.profile,
      thresholdPercent: policy.thresholdPercent,
      keepRecentPercent: policy.keepRecentPercent,
      safetyHeadroomTokens: policy.safetyHeadroomTokens,
    };
  }
}
