import {
  defineWorkbenchMethodHandlers,
  type WorkbenchMethodHandlerMap,
} from "../method-handler-registry.js";

export const interactionMethodHandlers: WorkbenchMethodHandlerMap =
  defineWorkbenchMethodHandlers({
    "tool.list": (state) => ({ tools: state.registry.tools.listTools() }),
    "toolCall.list": (state, params) =>
      state.registry.tools.queryToolCallPreviews({
        status: params?.status,
        pendingInteractionKind: params?.pendingInteractionKind,
        conversationId: params?.conversationId,
        projectId: params?.projectId,
        runId: params?.runId,
        limit: params?.limit,
        cursor: params?.cursor,
      }),
    "toolCall.get": async (state, params) =>
      await state.registry.tools.getToolCallUiDetails(params.toolCallId),
    "toolCall.interaction.resolve": async (state, params) => ({
      ...(await state.registry.resolveToolInteraction(params)),
    }),
  });
