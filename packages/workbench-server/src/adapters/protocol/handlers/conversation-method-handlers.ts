import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type ConversationMethodContext =
  ServerAdapterContexts["protocol"]["conversations"];
const defineConversationMethodHandlers =
  defineWorkbenchMethodHandlersFor<ConversationMethodContext>();

export const conversationMethodHandlers: WorkbenchMethodHandlerMapFor<ConversationMethodContext> =
  defineConversationMethodHandlers({
    "conversation.create": async (state, params) => ({
      conversation:
        await state.conversationLifecycle.createConversation(params),
    }),
    "conversation.import": (state, params) =>
      state.importService.importConversation(params as never),
    "conversation.list": (state) => ({
      conversations: state.conversationLifecycle.listConversations(),
    }),
    "conversation.get": (state, params) => ({
      conversation: state.conversationLifecycle.getConversation(
        params.conversationId,
      ),
    }),
    "conversation.delete": async (state, params) => {
      await state.conversationLifecycle.removeConversation(
        params.conversationId,
      );
      return { ok: true };
    },
    "conversation.state.update": async (state, params) => ({
      conversation: await state.conversationLifecycle.updateConversationState(
        params.conversationId,
        params,
      ),
    }),
    "conversation.entries.list": async (state, params) => {
      await state.conversationLifecycle.ensureConversationEntries(
        params.conversationId,
      );
      return {
        entries: state.conversationLifecycle.getConversationEntries(
          params.conversationId,
        ),
      };
    },
    "conversation.contextUsage.get": async (state, params) => ({
      contextUsage: await state.workbenchRun.getContextUsage(
        params.conversationId,
      ),
    }),
    "conversation.tree.get": async (state, params) => {
      await state.conversationLifecycle.ensureConversationEntries(
        params.conversationId,
      );
      return {
        tree: state.conversationLifecycle.getConversationTree(
          params.conversationId,
        ),
      };
    },
    "conversation.navigate": async (state, params) => ({
      conversation: await state.navigationService.navigateConversation(
        params.conversationId,
        params,
      ),
    }),
    "conversation.compact": (state, params) =>
      state.compactionService.compactConversation(
        params.conversationId,
        params,
        { reason: "manual" },
      ),
    "conversation.compaction.cancel": async (state, params) => {
      await state.compactionService.cancelCompaction(params.conversationId);
      return { ok: true };
    },
  });
