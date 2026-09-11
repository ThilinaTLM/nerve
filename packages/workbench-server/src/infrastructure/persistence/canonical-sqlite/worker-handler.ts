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
    case "persist_lifecycle_atomic_commit":
      return database.lifecycle.persistAtomicCommit(command.input);
    case "insert_lifecycle_work":
      return database.lifecycle.insert(command.work);
    case "read_lifecycle_work":
      return database.lifecycle.read(command.workId);
    case "list_due_lifecycle_work":
      return database.lifecycle.listDue(command.now, command.limit);
    case "list_expired_lifecycle_work":
      return database.lifecycle.listExpired(command.now, command.limit);
    case "claim_lifecycle_work":
      return database.lifecycle.claim(command.input);
    case "renew_lifecycle_work":
      return database.lifecycle.renew(command.input);
    case "settle_lifecycle_work":
      return database.lifecycle.settle(command.input);
    case "persist_recovery_issue":
      return database.lifecycle.persistRecoveryIssue(command.issue);
    case "list_recovery_issues":
      return database.lifecycle.listRecoveryIssues(command.conversationId);
    case "read_lifecycle_command_receipt":
      return database.lifecycle.readCommandReceipt(
        command.scopeId,
        command.requestId,
      );
    case "read_reconciliation_operation":
      return database.lifecycle.readReconciliationOperation(
        command.conversationId,
        command.requestId,
      );
    case "begin_reconciliation_operation":
      return database.lifecycle.beginReconciliationOperation(command.operation);
    case "settle_reconciliation_operation":
      return database.lifecycle.settleReconciliationOperation(
        command.operation,
      );
    case "read_rpc_idempotency":
      return database.readRpcIdempotency(
        command.scope,
        command.key,
        command.now,
      );
    case "write_rpc_idempotency":
      database.writeRpcIdempotency(
        command.entry,
        command.maxEntries,
        command.now,
      );
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
    case "read_conversation_revision":
      return database.readConversationRevision(command.conversationId);
    case "read_conversation_entries":
      return database.readConversationEntries(command.conversationId);
    case "scan_tool_calls":
      return database.scanToolCalls(command);
    case "read_tool_call":
      return database.readToolCall(command.toolCallId);
    case "count_tool_call_projections":
      return database.countToolCallProjections();
    case "query_tool_call_projections":
      return database.queryToolCallProjections(command.query);
    case "list_tool_call_startup_records":
      return database.listToolCallStartupRecords();
    case "tool_call_conversation_id":
      return database.toolCallConversationId(command.toolCallId);
    case "list_run_metadata":
      return database.listRunMetadata();
    case "list_run_states":
      return database.listRunStates(command.statuses);
    case "list_run_delivery_recovery_states":
      return database.listRunDeliveryRecoveryStates();
    case "read_run_state":
      return database.readRunState(command.runId);
    case "backfill_conversation_record_projections":
      return database.backfillConversationRecordProjections(command);
    case "list_conversation_journal_ids":
      return database.listConversationJournalIds();
    case "read_conversation_journal":
      return database.readConversationJournal(command.conversationId);
    case "checkpoint_conversation_state":
      database.checkpointEncodedConversationState(command.input);
      return undefined;
    case "delete_conversation_state_chunk":
      return database.deleteConversationStateChunk(
        command.conversationId,
        command.limit,
        command.cursor,
      );
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
