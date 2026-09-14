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
    case "count_legacy_runtime_authority":
      return database.timeline.countLegacy();
    case "read_legacy_lifecycle_authority_facts":
      return database.timeline.readLegacy();
    case "retire_legacy_runtime_authority":
      return database.timeline.retireLegacy();
    case "list_pending_canonical_deletions":
      return database.deletionCleanup.listPendingConversationIds(command.limit);
    case "read_canonical_deletion_intent":
      return database.deletionCleanup.readIntent(command.conversationId);
    case "read_canonical_deletion_tombstone":
      return database.deletionCleanup.readTombstone(command.conversationId);
    case "settle_canonical_deletion_execution":
      return database.deletionCleanup.settleExecution(
        command.conversationId,
        command.now,
      );
    case "claim_canonical_artifact_deletion":
      return database.deletionCleanup.claimArtifactWork(
        command.conversationId,
        command.limit,
        command.now,
      );
    case "settle_canonical_artifact_deletion":
      return database.deletionCleanup.settleArtifactWork(
        command.workId,
        command.state,
        command.error,
        command.now,
      );
    case "remove_canonical_deletion_history":
      return database.deletionCleanup.removeHistoryChunk(
        command.conversationId,
        command.limit,
        command.now,
      );
    case "redact_canonical_deletion_payloads":
      return database.deletionCleanup.redactPayloadChunk(
        command.conversationId,
        command.limit,
        command.now,
      );
    case "count_compaction_provider_phases":
      return database.executionQueries.countCompactionProviderPhases(
        command.runId,
      );
    case "claim_ready_canonical_lifecycle_work":
      return database.executionQueries.claimLifecycleWork({
        workerId: command.workerId,
        now: command.now,
        leaseDurationMs: command.leaseDurationMs,
        workId: command.workId,
      });
    case "read_canonical_run_execution_authority":
      return database.executionQueries.readRunExecutionAuthority(
        command.runId,
        command.phaseId,
      );
    case "read_canonical_artifact_manifest":
      return database.executionQueries.readArtifactManifest(command.manifestId);
    case "read_canonical_wait_group":
      return database.executionQueries.readWaitGroup(command.waitGroupId);
    case "read_canonical_authorization":
      return database.executionQueries.readAuthorization(
        command.authorizationId,
      );
    case "read_canonical_logical_effect":
      return database.executionQueries.readEffect(command.effectId);
    case "read_canonical_execution_attempt":
      return database.executionQueries.readAttempt(command.attemptId);
    case "read_canonical_execution_claim":
      return database.executionQueries.readClaim(command.claimId);
    case "read_canonical_provider_phase":
      return database.executionQueries.readProviderPhase(command.phaseId);
    case "read_canonical_lifecycle_work":
      return database.executionQueries.readLifecycleWork(command.workId);
    case "list_ready_canonical_lifecycle_work":
      return database.executionQueries.listReadyLifecycleWork(
        command.now,
        command.limit,
      );
    case "create_timeline_backup_snapshot":
      return database.backups.createSnapshot(command.destination);
    case "commit_conversation_command":
      return database.timeline.commit(command.input);
    case "read_timeline_command_receipt":
      return database.timeline.readCommandReceipt(command.input);
    case "read_timeline_state_identity":
      return database.timeline.readStateIdentity();
    case "read_timeline_runtime_admission":
      return database.timeline.readRuntimeAdmission();
    case "disable_timeline_runtime_admission":
      return database.timeline.disableRuntimeAdmission(command.now);
    case "promote_timeline_runtime_admission":
      return database.timeline.promoteRuntimeAdmission(command.promotion);
    case "read_timeline_conversation_head":
      return database.timeline.readHead(command.conversationId);
    case "record_timeline_transcript_projection_failure":
      return database.projections.recordTranscriptFailure(
        command.conversationId,
        command.message,
        command.now,
      );
    case "rebuild_timeline_transcript_projection":
      return database.projections.rebuildTranscript(
        command.conversationId,
        command.now,
        command.invalidateCursors,
      );
    case "read_pending_timeline_transcript_projections":
      return database.projections.readPendingTranscriptConversationIds(
        command.limit,
      );
    case "read_timeline_search_projection_page":
      return database.projections.readSearchPage({
        conversationId: command.conversationId,
        sourceRevision: command.sourceRevision,
        matchExpression: command.matchExpression,
        ...(command.afterDepth === undefined
          ? {}
          : { afterDepth: command.afterDepth }),
        ...(command.afterEntryId === undefined
          ? {}
          : { afterEntryId: command.afterEntryId }),
        limit: command.limit,
      });
    case "read_timeline_transcript_projection_page":
      return database.projections.readTranscriptPage({
        conversationId: command.conversationId,
        sourceRevision: command.sourceRevision,
        ...(command.beforeDepth === undefined
          ? {}
          : { beforeDepth: command.beforeDepth }),
        limit: command.limit,
      });
    case "read_timeline_transcript_projection_status":
      return database.projections.readTranscriptStatus(command.conversationId);
    case "read_timeline_deletion_state":
      return database.timeline.readDeletionState(command.conversationId);
    case "read_timeline_head_at_revision":
      return database.timeline.readHeadAtRevision(
        command.conversationId,
        command.revision,
      );
    case "read_timeline_run_control":
      return database.timeline.readRunControl(
        command.conversationId,
        command.runId,
      );
    case "read_timeline_fixed_tree_page":
      return database.timeline.readFixedTreePage({
        conversationId: command.conversationId,
        sourceRevision: command.sourceRevision,
        after: command.after,
        limit: command.limit,
      });
    case "read_timeline_fixed_ancestry_page":
      return database.timeline.readFixedAncestryPage({
        conversationId: command.conversationId,
        sourceEntryId: command.sourceEntryId,
        beforeDepth: command.beforeDepth,
        limit: command.limit,
      });
    case "read_timeline_ancestry_segment":
      return database.timeline.readAncestrySegment({
        conversationId: command.conversationId,
        sourceEntryId: command.sourceEntryId,
        limit: command.limit,
      });
    case "timeline_entry_is_ancestor":
      return database.timeline.isAncestor(
        command.conversationId,
        command.ancestorEntryId,
        command.descendantEntryId,
      );
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
    case "requeue_lifecycle_work":
      return database.lifecycle.requeue(command.input);
    case "settle_lifecycle_work":
      return database.lifecycle.settle(command.input);
    case "persist_recovery_issue":
      return database.lifecycle.persistRecoveryIssue(command.issue);
    case "list_recovery_issues":
      return database.lifecycle.listRecoveryIssues(command.conversationId);
    case "resolve_recovery_issues_for_run":
      return database.lifecycle.resolveRecoveryIssuesForRun(
        command.runId,
        command.now,
      );
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
