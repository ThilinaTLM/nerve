import {
  COMPLETION_RESULT_LIMIT,
  completionChangedSchema,
} from "@nervekit/contracts/completions";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import type { ComposerReferenceSource } from "$lib/presentation/composer/composer-editor-completions";

/** All acquisition/matching is server-owned; remote refresh never blocks typing. */
export function composerReferenceSource(
  projectId: string,
  conversationId?: string,
): ComposerReferenceSource {
  const scope = { projectId, ...(conversationId ? { conversationId } : {}) };
  return {
    search: (q, options) =>
      requestWorkbench("completion.search", {
        ...scope,
        q,
        limit: Math.min(
          options?.limit ?? COMPLETION_RESULT_LIMIT,
          COMPLETION_RESULT_LIMIT,
        ),
      }),
    async select(item, action) {
      if (!item.documentId || !item.version)
        throw new Error("Completion expired; search again");
      return (
        await requestWorkbench("completion.select", {
          ...scope,
          documentId: item.documentId,
          expectedVersion: item.version,
          action,
        })
      ).item;
    },
    subscribe(listener) {
      const event = onEvent("completion.changed", (message) => {
        const parsed = completionChangedSchema.safeParse(message.data);
        if (
          parsed.success &&
          parsed.data.projectId === projectId &&
          parsed.data.conversationId === conversationId
        )
          listener();
      });
      const reconnect = onWorkbenchReconnect(listener);
      return () => {
        event();
        reconnect();
      };
    },
  };
}
