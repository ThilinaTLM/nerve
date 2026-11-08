import type { ConversationEvent } from "@nervekit/contracts/core";
import type { CoreStorage } from "../../storage/core-storage.js";
import type { CoreEmitter } from "../../runtime/core-change.js";
import { publishSummary } from "../../runtime/publish-summary.js";
import {
  extractCreatedReferences,
  extractPromptReferences,
  parseGitRemote,
  type CreatedReferenceSource,
} from "./github.js";

export interface ReferenceExtractionOptions {
  storage: CoreStorage;
  emit: CoreEmitter;
  /** Local git configuration only; never performs network requests. */
  gitRemotes?(projectId: string): Promise<string[]>;
}
export class ReferenceExtraction {
  constructor(private readonly options: ReferenceExtractionOptions) {}
  async committed(event: ConversationEvent): Promise<void> {
    const { storage } = this.options;
    const conversation = storage.conversations.get(event.conversationId);
    if (!conversation) return;
    const prompt =
      event.type === "user_message" &&
      event.payload.source === "user" &&
      !conversation.parentConversationId;
    const tool =
      event.type === "tool_call_response" &&
      event.payload.outcome === "completed"
        ? /^(?:functions\.)?(bash|python_exec)$/.exec(
            event.payload.toolName,
          )?.[1]
        : undefined;
    const asyncBash =
      event.type === "system_event" &&
      event.payload.subtype === "task_result" &&
      event.payload.task.kind === "bash" &&
      event.payload.outcome === "completed";
    if (!prompt && !tool && !asyncBash) return;
    // python_exec scripts run from `path` have no inspectable code and are skipped.
    const source: CreatedReferenceSource =
      tool && event.type === "tool_call_response"
        ? tool === "bash"
          ? {
              kind: "shell",
              text: String(event.payload.arguments.command ?? ""),
            }
          : { kind: "python", text: String(event.payload.arguments.code ?? "") }
        : {
            kind: "shell",
            text:
              asyncBash &&
              event.type === "system_event" &&
              event.payload.subtype === "task_result" &&
              event.payload.task.kind === "bash"
                ? (storage.asyncBash.get(event.payload.task.id)?.command ?? "")
                : "",
          };
    const command = source.text;
    // Cheap candidate checks only; the pure parser still decides what is a reference.
    if (prompt && event.type === "user_message") {
      if (!/#\d|\/(?:pull|issues)\//i.test(event.payload.originalText)) return;
    } else if (!/\bgh\b[\s\S]*\b(?:pr|issue)\b[\s\S]*\bcreate\b/.test(command))
      return;
    const remotes = (
      (await this.options.gitRemotes?.(conversation.projectId)) ?? []
    ).flatMap((url) => {
      const remote = parseGitRemote(url);
      return remote ? [remote] : [];
    });
    // Remote discovery may yield while the conversation is being deleted.
    if (!storage.conversations.rawIdentity(conversation.id)) return;
    let references = [];
    if (prompt && event.type === "user_message")
      references = extractPromptReferences(event.payload.originalText, remotes);
    else {
      let output = "",
        exitCode: number | null = null;
      if (tool && event.type === "tool_call_response") {
        const preview = event.payload.userProjection.resultPreview;
        if (preview && typeof preview === "object" && !Array.isArray(preview)) {
          const details = preview.details;
          if (
            details &&
            typeof details === "object" &&
            !Array.isArray(details) &&
            typeof details.exitCode === "number"
          )
            exitCode = details.exitCode;
          else if (typeof preview.exitCode === "number")
            exitCode = preview.exitCode;
        }
        // The full agent-facing text; the user preview may hide lines.
        output = event.payload.agentProjection
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
      } else if (
        event.type === "system_event" &&
        event.payload.subtype === "task_result" &&
        event.payload.task.kind === "bash"
      ) {
        exitCode = event.payload.task.exitCode;
        output = event.payload.text.startsWith(`${command}\n`)
          ? event.payload.text.slice(command.length + 1)
          : "";
      }
      references = extractCreatedReferences(source, exitCode, output, remotes);
    }
    const changed = new Set<string>();
    storage.transaction(() => {
      for (const reference of references) {
        if (
          storage.references.upsert(
            conversation.id,
            reference,
            event.id,
            event.createdAt,
          )
        )
          changed.add(conversation.id);
        if (
          reference.relationship === "created" &&
          conversation.parentConversationId
        ) {
          let root = conversation;
          while (root.parentConversationId) {
            const parent = storage.conversations.get(root.parentConversationId);
            if (!parent) break;
            root = parent;
          }
          if (
            root.id !== conversation.id &&
            storage.references.upsert(
              root.id,
              reference,
              event.id,
              event.createdAt,
            )
          )
            changed.add(root.id);
        }
      }
    });
    for (const id of changed) publishSummary(storage, this.options.emit, id);
  }
}
