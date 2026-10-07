import {
  agentRecordSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type AgentMethodContext = ServerAdapterContexts["protocol"]["agents"];
const defineAgentMethodHandlers =
  defineWorkbenchMethodHandlersFor<AgentMethodContext>();

export const agentMethodHandlers: WorkbenchMethodHandlerMapFor<AgentMethodContext> =
  defineAgentMethodHandlers({
    "agent.create": async (state, params) => ({
      agent: agentResponseDto(await state.agentLifecycle.createAgent(params)),
    }),
    "agent.list": (state) => ({
      agents: state.agentLifecycle.listAgents().map(agentResponseDto),
    }),
    "agent.get": (state, params) => ({
      agent: agentResponseDto(state.agentLifecycle.getAgent(params.agentId)),
    }),
    "agent.subagentTranscript.get": async (state, params) => ({
      transcript: await state.subagentTranscripts.get(
        params.parentAgentId,
        params.childAgentId,
      ),
    }),
    "agent.history.get": (state, params) =>
      state.subagentTranscripts.snapshot(params.agentId),
    "agent.stop": async (state, params) => {
      let generation: number | undefined;
      await state.workbenchRun.abortAgent(params.agentId, (value) => {
        generation = value;
      });
      if (generation !== undefined)
        await notifyControl(state, params.agentId, "paused", generation);
      return { accepted: true, agentId: params.agentId };
    },
    "agent.resume": async (state, params) => {
      let generation: number | undefined;
      await state.workbenchRun.resumeAgent(
        params.agentId,
        (value) => {
          generation = value;
        },
        { authority: "user_administration" },
      );
      if (generation !== undefined)
        await notifyControl(state, params.agentId, "enabled", generation);
      return { accepted: true, agentId: params.agentId };
    },
    "agent.interrupt": async (state, params) => {
      await state.workbenchRun.interruptAgent(params.agentId, params, {
        authority: "user_administration",
      });
      return { accepted: true, agentId: params.agentId };
    },
    "agent.configure": async (state, params) => {
      const agent = await state.agentLifecycle.configureAgent(
        params.agentId,
        params,
        {
          actor: { kind: "user", userId: "authorized-user" },
          onConfigurationAccepted: (receipt) =>
            state.agentInterventions.configurationAccepted(receipt),
        },
      );
      return { agent: agentResponseDto(agent) };
    },
    "run.start": (state, params) => dispatchPrompt(state, "run.start", params),
    "run.steer": (state, params) => dispatchPrompt(state, "run.steer", params),
    "run.followUp": (state, params) =>
      dispatchPrompt(state, "run.followUp", params),
    "agent.promptQueue.list": async (state, params) => ({
      queuedPrompts: await state.workbenchRun.listQueuedPrompts(params.agentId),
    }),
    "agent.promptQueue.cancel": async (state, params) => ({
      queuedPrompt: await state.workbenchRun.cancelQueuedPrompt(
        params.agentId,
        params.queuedPromptId,
      ),
    }),
    "agent.promptQueue.forcePush": (state, params) =>
      state.workbenchRun.forcePushQueuedPrompts(params.agentId),
    "agent.requestTool": (state, params) =>
      state.tools.requestTool(
        state.agentLifecycle.getAgent(params.agentId),
        params.toolName,
        params.args as Record<string, unknown>,
      ),
    "run.continue": async (state, params) => {
      if (!params.agentId || !params.runId) {
        throw new Error("run.continue requires agentId and runId");
      }
      await state.workbenchRun.continueRun(params.agentId, params.runId);
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
      await state.workbenchRun.abortRun(params);
      return {
        accepted: true,
        agentId: params.agentId,
        runId: params.runId,
        status: "cancelled",
      };
    },
  });

/** Canonical public agent shape; unset optional object fields are absent on wire. */
function agentResponseDto(agent: AgentRecord): AgentRecord {
  // Validate the full declared reply first, including nested accepted settings.
  // Do not stringify arbitrary values (which would coerce NaN, dates/functions,
  // or sparse arrays). All other durability/credential fences remain in place.
  return omitUnsetProperties(agentRecordSchema.parse(agent)) as AgentRecord;
}

function omitUnsetProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUnsetProperties);
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, omitUnsetProperties(child)]),
    );
  }
  return value;
}

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
  await state.workbenchRun.promptAgent(request.agentId, {
    ...request,
    behavior:
      method === "run.steer"
        ? "steer"
        : method === "run.followUp"
          ? "follow-up"
          : "steer",
  } as never);
  return { accepted: true, agentId: request.agentId };
}

async function notifyControl(
  state: AgentMethodContext,
  agentId: string,
  activation: "enabled" | "paused",
  generation: number,
): Promise<void> {
  try {
    await state.agentInterventions.controlAccepted(
      agentId,
      generation,
      activation,
      state.agentLifecycle.getAgent(agentId).updatedAt,
    );
  } catch (error) {
    state.agentInterventions.deferred(
      error,
      `control:${agentId}:${activation}`,
    );
  }
}
