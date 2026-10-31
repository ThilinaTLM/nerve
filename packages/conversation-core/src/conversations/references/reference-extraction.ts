import type { ConversationEvent } from "@nervekit/contracts/core";
import type { CoreStorage } from "../../storage/core-storage.js";
import type { CoreEmitter } from "../../runtime/core-change.js";
import { publishSummary } from "../../runtime/publish-summary.js";
import {
  extractCreatedReference,
  extractPromptReferences,
  parseGitRemote,
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
    const bash =
      event.type === "tool_call_response" &&
      event.payload.outcome === "completed" &&
      /^(?:functions\.)?bash$/.test(event.payload.toolName);
    const asyncBash =
      event.type === "system_event" &&
      event.payload.subtype === "async_bash_event" &&
      event.payload.status === "completed";
    if (!prompt && !bash && !asyncBash) return;
    const command =
      bash && event.type === "tool_call_response"
        ? String(event.payload.arguments.command ?? "")
        : asyncBash &&
            event.type === "system_event" &&
            event.payload.subtype === "async_bash_event"
          ? (storage.asyncBash.get(event.payload.bashId)?.command ?? "")
          : "";
    // Cheap candidate checks only; the pure parser still decides what is a reference.
    if (prompt && event.type === "user_message") {
      if (!/#\d|\/(?:pull|issues)\//i.test(event.payload.originalText)) return;
    } else if (!/\bgh\s+(?:pr|issue)\s+create\b/.test(command)) return;
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
      if (bash && event.type === "tool_call_response") {
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
          output =
            typeof preview.content === "string"
              ? preview.content
              : JSON.stringify(preview.content ?? "");
        }
      } else if (
        event.type === "system_event" &&
        event.payload.subtype === "async_bash_event"
      ) {
        exitCode = event.payload.exitCode;
        output = event.payload.text.startsWith(`${command}\n`)
          ? event.payload.text.slice(command.length + 1)
          : "";
      }
      const created = extractCreatedReference(
        command,
        exitCode,
        output,
        remotes,
      );
      references = created ? [created] : [];
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
