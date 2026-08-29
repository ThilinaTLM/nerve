import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
  type WorkbenchOperationContext,
} from "../method-handler-registry.js";

type ConversationMethodContext = Pick<WorkbenchOperationContext, "services">;
const defineConversationMethodHandlers =
  defineWorkbenchMethodHandlersFor<ConversationMethodContext>();

export const conversationMethodHandlers: WorkbenchMethodHandlerMapFor<ConversationMethodContext> =
  defineConversationMethodHandlers({
    "conversation.create": async (state, params) => ({
      conversation:
        await state.services.conversationLifecycle.createConversation(params),
    }),
    "conversation.import": (state, params) =>
      state.services.importService.importConversation(params as never),
    "conversation.list": (state) => ({
      conversations: state.services.conversationLifecycle.listConversations(),
    }),
    "conversation.get": (state, params) => ({
      conversation: state.services.conversationLifecycle.getConversation(
        params.conversationId,
      ),
    }),
    "conversation.delete": async (state, params) => {
      await state.services.conversationLifecycle.removeConversation(
        params.conversationId,
      );
      return { ok: true };
    },
    "conversation.state.update": async (state, params) => ({
      conversation:
        await state.services.conversationLifecycle.updateConversationState(
          params.conversationId,
          params,
        ),
    }),
    "conversation.entries.list": (state, params) => ({
      entries: state.services.conversationLifecycle.getConversationEntries(
        params.conversationId,
      ),
    }),
    "conversation.contextUsage.get": async (state, params) => ({
      contextUsage: await state.services.workbenchRun.getContextUsage(
        params.conversationId,
      ),
    }),
    "conversation.tree.get": (state, params) => ({
      tree: state.services.conversationLifecycle.getConversationTree(
        params.conversationId,
      ),
    }),
    "conversation.navigate": async (state, params) => ({
      conversation: await state.services.navigationService.navigateConversation(
        params.conversationId,
        params,
      ),
    }),
    "conversation.compact": (state, params) =>
      state.services.compactionService.compactConversation(
        params.conversationId,
        params,
        { reason: "manual" },
      ),
    "conversation.compaction.cancel": async (state, params) => {
      await state.services.compactionService.cancelCompaction(
        params.conversationId,
      );
      return { ok: true };
    },
  });
