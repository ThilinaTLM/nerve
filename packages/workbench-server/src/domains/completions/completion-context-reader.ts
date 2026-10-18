import { isAbsolute, relative, resolve } from "node:path";
import type { TransferredConversationEvent } from "@nervekit/contracts/core";
import type { CompletionScope } from "@nervekit/contracts/completions";
import type { CompletionContext } from "./completion-ranking-policy.js";
import { isUnsafeCompletionQuery } from "./file-completion-items.js";

/** Bounded, read-only context from authorized server history, never client scores
 * or tool permissions. No table/column, full transcript, or file-content reads. */
export type CompletionContextReaderPorts = {
  metadata(conversationId: string): { projectId: string; lastSequence: number };
  history(
    conversationId: string,
    page: { limit: number },
  ): TransferredConversationEvent[];
  project(projectId: string): { directory: string };
};
export function createCompletionContextReader(
  ports: CompletionContextReaderPorts,
): (scope: CompletionScope) => CompletionContext {
  const cache = new Map<
    string,
    { sequence: number; root: string; context: CompletionContext }
  >();
  return (scope) => {
    if (!scope.conversationId) return {};
    const metadata = ports.metadata(scope.conversationId);
    if (metadata.projectId !== scope.projectId)
      throw new Error("Conversation belongs to another project");
    const root = resolve(ports.project(scope.projectId).directory);
    const existing = cache.get(scope.conversationId);
    if (existing?.sequence === metadata.lastSequence && existing.root === root)
      return existing.context;
    const referenced = new Set<string>();
    const edited = new Set<string>();
    const add = (value: unknown, target: Set<string>) => {
      if (
        typeof value !== "string" ||
        value.length > 4096 ||
        target.size >= 128
      )
        return;
      const normalized = value
        .replace(/^@(?:file:)?/, "")
        .replaceAll("\\", "/")
        .replace(/[),;]+$/, "");
      const path = isAbsolute(normalized)
        ? relative(root, normalized).replaceAll("\\", "/")
        : normalized;
      if (!path || isUnsafeCompletionQuery(path)) return;
      target.add(path.replace(/\/$/, ""));
    };
    for (const event of ports.history(scope.conversationId, { limit: 64 })) {
      if (event.conversationId !== scope.conversationId) continue;
      if (event.type === "user_message") {
        for (const match of event.payload.text
          .slice(0, 32_768)
          .matchAll(/@(?:file:)?([^\s@]+)/g)) {
          if (!/^(?:pr|issue|launch|skill|tool|agent|profile):/.test(match[1]))
            add(match[1], referenced);
        }
      } else if (
        event.type === "tool_call_response" &&
        event.payload.outcome === "completed"
      ) {
        const args = event.payload.arguments;
        const target = ["edit", "write"].includes(event.payload.toolName)
          ? edited
          : referenced;
        // A command string is deliberately not a path or completion source.
        add(args.path ?? args.filePath, target);
        if (Array.isArray(args.paths))
          for (const path of args.paths.slice(0, 32)) add(path, target);
      }
    }
    const context = {
      referencedPaths: [...referenced],
      editedPaths: [...edited],
    };
    cache.delete(scope.conversationId);
    while (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(scope.conversationId, {
      sequence: metadata.lastSequence,
      root,
      context,
    });
    return context;
  };
}
