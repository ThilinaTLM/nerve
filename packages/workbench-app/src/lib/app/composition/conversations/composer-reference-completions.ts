import {
  FILE_COMPLETION_RESULT_LIMIT,
  completionChangedSchema,
  type CompletionItem,
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
    search: (q) =>
      requestWorkbench("completion.search", {
        ...scope,
        q,
        limit: FILE_COMPLETION_RESULT_LIMIT,
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

// Existing project-only consumers route to the same native unified service.
// These are transport adapters, not a second lexical/filtering implementation.
export async function fileCompletions(
  projectId: string | undefined,
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  return (await composerReferenceSource(projectId).search(query)).items;
}
export async function referenceCompletions(
  projectId: string | undefined,
  kind: "launch" | "pull_request",
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  return (
    await composerReferenceSource(projectId).search(
      `${kind === "launch" ? "launch" : "pr"}:${query}`,
    )
  ).items;
}
