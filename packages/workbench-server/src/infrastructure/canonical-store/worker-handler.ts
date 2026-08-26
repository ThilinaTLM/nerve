import type { CanonicalDatabase } from "./canonical-database.js";
import type { CanonicalCommand } from "./worker-protocol.js";

export function executeCanonicalCommand(
  database: CanonicalDatabase,
  command: CanonicalCommand,
): unknown {
  switch (command.kind) {
    case "initialize":
      database.initialize();
      return undefined;
    case "read_document":
      return database.readDocument(
        command.namespace,
        command.scopeId,
        command.documentId,
      );
    case "list_documents":
      return database.listDocuments(command.namespace, command.scopeId);
    case "list_document_keys":
      return database.listDocumentKeys(command.namespace, command.scopeId);
    case "write_document":
      return database.writeDocument(command.input);
    case "delete_document":
      database.deleteDocument(
        command.namespace,
        command.scopeId,
        command.documentId,
      );
      return undefined;
    case "list_permission_rules":
      return database.listPermissionRules(command.projectId);
    case "replace_permission_rules":
      database.replacePermissionRules(
        command.scope,
        command.projectId,
        command.rules,
      );
      return undefined;
    case "append_durable_event":
      return database.appendDurableEvent(command.input);
    case "durable_event_for_intent":
      return database.durableEventForIntent(command.intentId);
    case "read_durable_events":
      return database.readDurableEvents(
        command.stream,
        command.fromSequence,
        command.limit,
      );
    case "durable_event_bounds":
      return database.durableEventBounds(command.stream);
    case "remove_durable_event_stream":
      database.removeDurableEventStream(command.stream);
      return undefined;
    case "persist_conversation_state":
      database.persistConversationState(command.state, command.commit);
      return undefined;
    case "persist_conversation_commit":
      database.persistConversationCommit(command.delta);
      return undefined;
    case "list_conversation_journal_ids":
      return database.listConversationJournalIds();
    case "read_conversation_journal":
      return database.readConversationJournal(command.conversationId);
    case "checkpoint_conversation_state":
      database.checkpointConversationState(command.state);
      return undefined;
    case "delete_conversation_state":
      database.deleteConversationState(command.conversationId);
      return undefined;
    case "integrity_check":
      database.integrityCheck();
      return undefined;
    case "checkpoint":
      return undefined;
    case "close":
      database.close();
      return undefined;
  }
}
