import {
  compactionFailureOutcome,
  type CompactionOutcome,
} from "../../conversations/operations/compaction-service.js";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  computeContextUsage,
  deriveAutoCompactionPolicy,
  estimateTokens,
  getCompactionDecisionTokens,
  shouldAutoCompact,
} from "@nervekit/harness/compaction";
import { type Conversation } from "@nervekit/harness/conversation";
import { getModelContextWindow } from "@nervekit/harness/models";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ContextUsage } from "@nervekit/contracts/models";
import type { WorkbenchAgentMechanicsDeps } from "./workbench-agent-mechanics.js";
import { compactionSettingsForAgent } from "./subagent-compaction-settings.js";

const MAX_AUTO_CONTINUATIONS_PER_RUN = 3;

export const AUTO_COMPACTION_CONTINUE_MESSAGE =
  "Context was compacted into the checkpoint above. Preserve the original requirements and assignment, continue from the working state and remaining work, skip completed work, then validate and stop when done.";

export class AutoCompactionRunner {
  private readonly continuationCounts = new Map<string, number>();

  constructor(readonly deps: WorkbenchAgentMechanicsDeps) {}

  /** Compute usage for the root conversation, or an explicitly selected agent owner. */
  async getContextUsage(
    conversationId: string,
    agentId?: string,
  ): Promise<ContextUsage> {
    const conversation = this.deps.state.getConversation(conversationId);
    const agent =
      agentId !== undefined
        ? this.deps.state.agents.get(agentId)
        : conversation.activeAgentId
          ? this.deps.state.agents.get(conversation.activeAgentId)
          : undefined;
    if (
      agentId !== undefined &&
      (!agent || agent.conversationId !== conversationId)
    )
      throw new Error(
        "Context usage agent does not belong to the conversation.",
      );
    const storage =
      agentId !== undefined && agent
        ? await this.deps.harnessStorage.openAgentStorage(agent)
        : await this.deps.harnessStorage.openStorage(conversation);
    const branch = await storage.getContextPath();
    const messages = (await storage.buildContext()).messages;
    const contextWindow = getModelContextWindow(
      agent?.model,
      (await this.deps.customModels?.(agent?.projectDir)) ?? [],
    );
    return computeContextUsage(messages, branch, contextWindow);
  }

  async publishContextUsage(
    conversationId: string,
    agentId: string,
    runId: string,
  ): Promise<void> {
    const contextUsage = await this.getContextUsage(conversationId, agentId);
    await this.deps.events.publish("conversation.context.updated", {
      conversationId,
      agentId,
      runId,
      contextUsage,
    });
  }

  async maybeCompactBeforePrompt(input: {
    actor?: AgentRecord;
    conversationId: string;
    agentId: string;
    runId: string;
    text: string;
    images?: ImageContent[];
    conversation: Conversation;
    signal?: AbortSignal;
  }): Promise<CompactionOutcome> {
    const promptTokens =
      input.text || input.images?.length
        ? estimateTokens({
            role: "user",
            content: [
              { type: "text", text: input.text },
              ...(input.images ?? []),
            ],
            timestamp: Date.now(),
          })
        : 0;
    return this.maybeCompact({
      actor: input.actor,
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      additionalTokens: promptTokens,
      instructions:
        "Preventive compaction before a pending user prompt reaches the selected model context limit.",
      conversation: input.conversation,
      signal: input.signal,
    });
  }

  async maybeCompactAtIteration(input: {
    conversationId: string;
    agentId: string;
    runId: string;
    conversation: Conversation;
    signal?: AbortSignal;
  }): Promise<CompactionOutcome> {
    return this.maybeCompact({
      ...input,
      additionalTokens: 0,
      instructions:
        "Automatic compaction at an agent iteration boundary before the next provider request.",
    });
  }

  takeContinuation(runId: string, child = false): string | undefined {
    const count = this.continuationCounts.get(runId) ?? 0;
    if (count >= MAX_AUTO_CONTINUATIONS_PER_RUN) return undefined;
    this.continuationCounts.set(runId, count + 1);
    return (
      AUTO_COMPACTION_CONTINUE_MESSAGE +
      (child ? " Report your result to the lead when done." : "")
    );
  }

  finishRun(runId: string): void {
    this.continuationCounts.delete(runId);
  }

  private async maybeCompact(input: {
    actor?: AgentRecord;
    conversationId: string;
    agentId: string;
    runId: string;
    additionalTokens: number;
    instructions: string;
    conversation: Conversation;
    signal?: AbortSignal;
  }): Promise<CompactionOutcome> {
    const conversation = this.deps.state.getConversation(input.conversationId);
    const agent =
      input.actor ??
      this.resolveAgent(conversation.activeAgentId, input.agentId);
    const effectiveSettings = agent
      ? await this.deps.capabilities.settings(
          agent.projectId,
          agent.conversationId,
        )
      : this.deps.storage.settings;
    const settings = compactionSettingsForAgent(effectiveSettings, agent);
    if (!settings.auto)
      return { status: "not_needed", reason: "auto_disabled" };
    const contextWindow = getModelContextWindow(
      agent?.model,
      (await this.deps.customModels?.(agent?.projectDir)) ?? [],
    );
    const policy = deriveAutoCompactionPolicy(contextWindow, settings);
    if (!policy.enabled || contextWindow <= 0)
      return { status: "not_needed", reason: "policy_disabled" };

    const branch = await input.conversation.getContextBranch();
    const messages = (await input.conversation.buildContext()).messages;
    const contextTokens =
      getCompactionDecisionTokens(messages, branch) + input.additionalTokens;
    if (!shouldAutoCompact(contextTokens, policy))
      return { status: "not_needed", reason: "below_threshold" };

    try {
      await this.deps.compactionService.compactConversation(
        input.conversationId,
        { instructions: input.instructions },
        {
          ...this.compactionOptions(
            policy,
            input.agentId,
            input.runId,
            contextTokens,
          ),
          pendingPromptTokens: input.additionalTokens,
          activeConversation: input.conversation,
          signal: input.signal,
        },
      );
      return { status: "compacted", reason: "checkpoint_committed" };
    } catch (error) {
      const outcome = compactionFailureOutcome(error, input.signal);
      await this.deps.logger.warn(
        "Automatic context compaction did not commit",
        {
          agentId: input.agentId,
          conversationId: input.conversationId,
          runId: input.runId,
          context: { outcome },
          error,
        },
      );
      return outcome;
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
