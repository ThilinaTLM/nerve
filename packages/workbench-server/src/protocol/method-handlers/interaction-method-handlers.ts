import { toToolCallTranscriptRecord } from "../../domains/tools/tool-call-transcript-preview.js";
import {
  defineWorkbenchMethodHandlers,
  type WorkbenchMethodHandlerMap,
} from "../method-handler-registry.js";

export const interactionMethodHandlers: WorkbenchMethodHandlerMap =
  defineWorkbenchMethodHandlers({
    "tool.list": (state) => ({ tools: state.registry.tools.listTools() }),
    "toolCall.list": (state, params) => {
      let toolCalls = state.registry.tools.listToolCalls();
      if (params?.status)
        toolCalls = toolCalls.filter(
          (toolCall) => toolCall.status === params.status,
        );
      if (params?.pendingInteractionKind) {
        toolCalls = toolCalls.filter((toolCall) =>
          toolCall.interactions.some(
            (interaction) =>
              interaction.status === "pending" &&
              interaction.kind === params.pendingInteractionKind,
          ),
        );
      }
      if (params?.conversationId)
        toolCalls = toolCalls.filter(
          (toolCall) => toolCall.conversationId === params.conversationId,
        );
      if (params?.projectId)
        toolCalls = toolCalls.filter(
          (toolCall) => toolCall.projectId === params.projectId,
        );
      if (params?.runId)
        toolCalls = toolCalls.filter(
          (toolCall) => toolCall.runId === params.runId,
        );
      if (params?.limit !== undefined)
        toolCalls = toolCalls.slice(0, params.limit);
      return { toolCalls: toolCalls.map(toToolCallTranscriptRecord) };
    },
    "toolCall.get": (state, params) => ({
      toolCall: state.registry.tools.getToolCall(params.toolCallId),
    }),
    "toolCall.interaction.resolve": async (state, params) => ({
      ...(await state.registry.resolveToolInteraction(params)),
    }),
  });
