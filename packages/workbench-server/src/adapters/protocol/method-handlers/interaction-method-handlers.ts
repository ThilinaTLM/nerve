import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
  type WorkbenchOperationContext,
} from "../method-handler-registry.js";

type InteractionMethodContext = Pick<
  WorkbenchOperationContext,
  "registry" | "services"
>;
const defineInteractionMethodHandlers =
  defineWorkbenchMethodHandlersFor<InteractionMethodContext>();

export const interactionMethodHandlers: WorkbenchMethodHandlerMapFor<InteractionMethodContext> =
  defineInteractionMethodHandlers({
    "tool.list": (state) => ({ tools: state.services.tools.listTools() }),
    "toolCall.list": (state, params) =>
      state.services.tools.queryToolCallPreviews({
        status: params?.status,
        pendingInteractionKind: params?.pendingInteractionKind,
        conversationId: params?.conversationId,
        projectId: params?.projectId,
        runId: params?.runId,
        limit: params?.limit,
        cursor: params?.cursor,
      }),
    "toolCall.get": async (state, params) =>
      await state.services.tools.getToolCallUiDetails(params.toolCallId),
    "toolCall.result.read": async (state, params) =>
      await state.services.tools.readToolCallResult(
        params.toolCallId,
        params.byteOffset ?? 0,
        params.byteLimit ?? 64 * 1024,
      ),
    "toolCall.interaction.resolve": async (state, params) => ({
      ...(await state.registry.resolveToolInteraction(params)),
    }),
  });
