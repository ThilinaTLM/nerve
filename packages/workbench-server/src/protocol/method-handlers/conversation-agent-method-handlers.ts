import type { OrchestratorState } from "../../app/orchestrator-state.js";
import { defineWorkbenchMethodHandlers } from "../method-handler-registry.js";

export const conversationAgentMethodHandlers = defineWorkbenchMethodHandlers({
  "conversation.create": async (state, params) => ({
    conversation: await state.registry.createConversation(params),
  }),
  "conversation.import": (state, params) =>
    state.registry.importConversation(params as never),
  "conversation.list": (state) => ({
    conversations: state.registry.listConversations(),
  }),
  "conversation.get": (state, params) => ({
    conversation: state.registry.getConversation(params.conversationId),
  }),
  "conversation.delete": async (state, params) => {
    await state.registry.removeConversation(params.conversationId);
    return { ok: true };
  },
  "conversation.entries.list": (state, params) => ({
    entries: state.registry.getConversationEntries(params.conversationId),
  }),
  "conversation.contextUsage.get": async (state, params) => ({
    contextUsage: await state.registry.getContextUsage(params.conversationId),
  }),
  "conversation.tree.get": (state, params) => ({
    tree: state.registry.getConversationTree(params.conversationId),
  }),
  "conversation.navigate": async (state, params) => ({
    conversation: await state.registry.navigateConversation(
      params.conversationId,
      params,
    ),
  }),
  "conversation.compact": (state, params) =>
    state.registry.compactConversation(params.conversationId, params),
  "conversation.compaction.cancel": (state, params) =>
    state.registry.cancelConversationCompaction(params.conversationId),
  "agent.create": async (state, params) => ({
    agent: await state.registry.createAgent(params),
  }),
  "agent.list": (state) => ({ agents: state.registry.listAgents() }),
  "agent.get": (state, params) => ({
    agent: state.registry.getAgent(params.agentId),
  }),
  "agent.configure": async (state, params) => ({
    agent: await state.registry.configureAgent(params.agentId, params),
  }),
  "run.start": (state, params) => dispatchPrompt(state, "run.start", params),
  "run.steer": (state, params) => dispatchPrompt(state, "run.steer", params),
  "run.followUp": (state, params) =>
    dispatchPrompt(state, "run.followUp", params),
  "agent.promptQueue.list": async (state, params) => ({
    queuedPrompts: await state.registry.listQueuedPrompts(params.agentId),
  }),
  "agent.promptQueue.cancel": async (state, params) => ({
    queuedPrompt: await state.registry.cancelQueuedPrompt(
      params.agentId,
      params.queuedPromptId,
    ),
  }),
  "agent.requestTool": (state, params) =>
    state.registry.requestTool(
      params.agentId,
      params.toolName,
      params.args as Record<string, unknown>,
    ),
  "run.continue": async (state, params) => {
    if (!params.agentId || !params.runId) {
      throw new Error("run.continue requires agentId and runId");
    }
    await state.registry.continueRun(params.agentId, params.runId);
    return {
      accepted: true,
      agentId: params.agentId,
      runId: params.runId,
    };
  },
  "run.cancel": async (state, params) => {
    if (!params.agentId && !params.runId) {
      throw new Error("run.cancel requires agentId or runId");
    }
    await state.registry.abortRun(params);
    return {
      accepted: true,
      agentId: params.agentId,
      runId: params.runId,
      status: "cancelled",
    };
  },
});

type PromptMethod = "run.start" | "run.steer" | "run.followUp";

type PromptRequest = {
  agentId?: string;
  text: string;
  images?: unknown[];
};

async function dispatchPrompt(
  state: OrchestratorState,
  method: PromptMethod,
  request: PromptRequest,
) {
  if (!request.agentId) throw new Error(`${method} requires agentId`);
  await state.registry.promptAgent(request.agentId, {
    ...request,
    behavior:
      method === "run.steer"
        ? "steer"
        : method === "run.followUp"
          ? "follow-up"
          : "reject-if-busy",
  } as never);
  return { accepted: true, agentId: request.agentId };
}
