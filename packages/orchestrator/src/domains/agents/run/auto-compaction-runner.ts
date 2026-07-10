import {
  type AgentMessage,
  buildConversationContext,
  computeContextUsage,
  deriveAutoCompactionPolicy,
  getModelContextWindow,
  shouldAutoCompact,
} from "@nervekit/agent-runtime";
import type {
  AgentRecord,
  ContextUsage,
  ConversationEntry,
} from "@nervekit/contracts";
import type { AgentRunnerDeps } from "./agent-runner.js";

/** Max consecutive auto-continuations per conversation before stopping. */
const MAX_AUTO_CONTINUATIONS = 3;

/** Fixed handover instruction pushed after automatic compaction. */
const AUTO_CONTINUE_MESSAGE =
  "Continue the work using the context checkpoint above. Resume from the Next Steps and keep going until the task is complete. If everything is already finished, briefly confirm completion and stop.";

export class AutoCompactionRunner {
  constructor(
    readonly deps: AgentRunnerDeps,
    readonly autoContinuationCounts: Map<string, number>,
    readonly continueAgent: (agentId: string) => Promise<void>,
  ) {}

  /** Compute compaction-aware context-window usage for a conversation. */
  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    const conversation = this.deps.state.getConversation(conversationId);
    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessManager.openStorage(
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
    await this.deps.events.publish(
      "conversation.context.updated",
      { conversationId, agentId, runId, contextUsage },
      { durability: "transient" },
    );
  }

  async maybeAutoCompact(
    conversationId: string,
    agentId?: string,
    runId?: string,
  ): Promise<void> {
    if (!this.deps.storage.settings.compaction.auto) return;
    const conversation = this.deps.state.getConversation(conversationId);
    const agent =
      (agentId ? this.deps.state.agents.get(agentId) : undefined) ??
      (conversation.activeAgentId
        ? this.deps.state.agents.get(conversation.activeAgentId)
        : undefined);
    const contextWindow = getModelContextWindow(agent?.model);
    if (contextWindow <= 0) return;

    const project = this.deps.state.getProject(conversation.projectId);
    const storage = await this.deps.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const branch = await storage.getPathToRoot(await storage.getLeafId());
    const messages = buildConversationContext(branch).messages;
    const contextUsage = computeContextUsage(messages, branch, contextWindow);
    if (contextUsage.tokens === null) return;

    const policy = deriveAutoCompactionPolicy(
      contextWindow,
      this.deps.storage.settings.compaction.auto,
    );
    if (!shouldAutoCompact(contextUsage.tokens, policy)) return;
    await this.deps.compactionService.compactConversation(
      conversationId,
      {
        instructions:
          "Automatic compaction after the selected model approached its context window.",
      },
      {
        reason: "threshold",
        agentId: agent?.id,
        runId,
        contextWindow: policy.contextWindow,
        contextTokens: contextUsage.tokens,
        thresholdTokens: policy.thresholdTokens,
        triggerReserveTokens: policy.triggerReserveTokens,
        keepRecentTokens: policy.keepRecentTokens,
      },
    );
    // Compaction succeeded: hand the work back to the agent so it continues
    // from the fresh context checkpoint instead of stopping.
    if (agent) await this.continueAfterAutoCompaction(agent);
  }

  /**
   * Push a normal handover user message and start a continuation run after an
   * automatic compaction, bounded by a per-conversation runaway guard.
   */
  async continueAfterAutoCompaction(agent: AgentRecord): Promise<void> {
    const count = this.autoContinuationCounts.get(agent.conversationId) ?? 0;
    if (count >= MAX_AUTO_CONTINUATIONS) return;
    this.autoContinuationCounts.set(agent.conversationId, count + 1);
    const entry = await this.appendAutoContinueMessage(
      agent,
      AUTO_CONTINUE_MESSAGE,
    );
    await this.deps.events.publish("conversation.entry.appended", {
      conversationId: entry.conversationId,
      agentId: entry.agentId,
      runId: entry.runId,
      entry,
    });
    void this.continueAgent(agent.id).catch(() => undefined);
  }

  async appendAutoContinueMessage(
    agent: AgentRecord,
    text: string,
  ): Promise<ConversationEntry> {
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
        role: "user",
        text,
        createdAt: appended.timestamp,
      },
      { mirrorToHarness: false },
    );
  }
}
