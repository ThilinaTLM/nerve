import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
  type WorkbenchOperationContext,
} from "../method-handler-registry.js";

type AgentMethodContext = Pick<WorkbenchOperationContext, "services">;
const defineAgentMethodHandlers =
  defineWorkbenchMethodHandlersFor<AgentMethodContext>();

export const agentMethodHandlers: WorkbenchMethodHandlerMapFor<AgentMethodContext> =
  defineAgentMethodHandlers({
    "agent.create": async (state, params) => ({
      agent: await state.services.agentLifecycle.createAgent(params),
    }),
    "agent.list": (state) => ({
      agents: state.services.agentLifecycle.listAgents(),
    }),
    "agent.get": (state, params) => ({
      agent: state.services.agentLifecycle.getAgent(params.agentId),
    }),
    "agent.subagentTranscript.get": async (state, params) => ({
      transcript: await state.services.subagentTranscripts.get(
        params.parentAgentId,
        params.childAgentId,
      ),
    }),
    "agent.configure": async (state, params) => ({
      agent: await state.services.agentLifecycle.configureAgent(
        params.agentId,
        params,
      ),
    }),
    "run.start": (state, params) => dispatchPrompt(state, "run.start", params),
    "run.steer": (state, params) => dispatchPrompt(state, "run.steer", params),
    "run.followUp": (state, params) =>
      dispatchPrompt(state, "run.followUp", params),
    "agent.promptQueue.list": async (state, params) => ({
      queuedPrompts: await state.services.workbenchRun.listQueuedPrompts(
        params.agentId,
      ),
    }),
    "agent.promptQueue.cancel": async (state, params) => ({
      queuedPrompt: await state.services.workbenchRun.cancelQueuedPrompt(
        params.agentId,
        params.queuedPromptId,
      ),
    }),
    "agent.promptQueue.forcePush": (state, params) =>
      state.services.workbenchRun.forcePushQueuedPrompts(params.agentId),
    "agent.requestTool": (state, params) =>
      state.services.tools.requestTool(
        state.services.agentLifecycle.getAgent(params.agentId),
        params.toolName,
        params.args as Record<string, unknown>,
      ),
    "run.continue": async (state, params) => {
      if (!params.agentId || !params.runId) {
        throw new Error("run.continue requires agentId and runId");
      }
      await state.services.workbenchRun.continueRun(
        params.agentId,
        params.runId,
      );
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
      await state.services.workbenchRun.abortRun(params);
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
  state: AgentMethodContext,
  method: PromptMethod,
  request: PromptRequest,
) {
  if (!request.agentId) throw new Error(`${method} requires agentId`);
  await state.services.workbenchRun.promptAgent(request.agentId, {
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
