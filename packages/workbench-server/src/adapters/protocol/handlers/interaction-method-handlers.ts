import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type InteractionMethodContext =
  ServerAdapterContexts["protocol"]["interactions"];
const defineInteractionMethodHandlers =
  defineWorkbenchMethodHandlersFor<InteractionMethodContext>();

export const interactionMethodHandlers: WorkbenchMethodHandlerMapFor<InteractionMethodContext> =
  defineInteractionMethodHandlers({
    "tool.list": (state) => ({ tools: state.tools.listTools() }),
    "toolCall.list": (state, params) =>
      state.tools.queryToolCallPreviews({
        status: params?.status,
        pendingInteractionKind: params?.pendingInteractionKind,
        conversationId: params?.conversationId,
        projectId: params?.projectId,
        runId: params?.runId,
        limit: params?.limit,
        cursor: params?.cursor,
      }),
    "toolCall.get": async (state, params) =>
      await state.tools.getToolCallUiDetails(params.toolCallId),
    "toolCall.result.read": async (state, params) =>
      await state.tools.readToolCallResult(
        params.toolCallId,
        params.byteOffset ?? 0,
        params.byteLimit ?? 64 * 1024,
      ),
    "toolCall.interaction.resolve": async (state, params) => ({
      ...(await state.toolInteractions.resolve(params)),
    }),
  });
