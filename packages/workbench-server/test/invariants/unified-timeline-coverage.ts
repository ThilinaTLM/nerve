export interface UnifiedTimelineEvidence {
  file: string;
  testId: string;
}

export const unifiedTimelineInvariantCoverage = [
  [
    "INV-AUTH-01",
    1,
    "single authority and mutation inventory",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-conversation-creation-service.test.ts",
        testId:
          "INV-AUTH-01 imports history through one canonical creation command",
      },
    ],
  ],
  [
    "INV-ID-01",
    1,
    "identity, ancestry, and ordering",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-timeline-commit.test.ts",
        testId:
          "INV-ID-01 rolls back a command with an invalid cross-owner parent",
      },
    ],
  ],
  [
    "INV-HEAD-01",
    2,
    "head ownership and selection fences",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/unified-transition-validation.test.ts",
        testId: "INV-HEAD-01 navigation increments epoch and fences the owner",
      },
    ],
  ],
  [
    "INV-COMMIT-01",
    2,
    "atomic transition failure injection",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-timeline-commit.test.ts",
        testId:
          "INV-COMMIT-01 does not create one owner when another CAS precondition fails",
      },
    ],
  ],
  [
    "INV-RECEIPT-01",
    2,
    "durable semantic command replay",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-timeline-commit.test.ts",
        testId:
          "INV-RECEIPT-01 replays before stale CAS and rejects changed fingerprints",
      },
    ],
  ],
  [
    "INV-OUTCOME-01",
    7,
    "typed producer and consumer outcomes",
    [
      {
        file: "packages/workbench-app/src/lib/features/conversations/state/canonical-timeline-projection.test.ts",
        testId:
          "INV-OUTCOME-01 projects only canonical page rows into transcript state",
      },
    ],
  ],
  [
    "INV-CHECKPOINT-01",
    4,
    "canonical checkpoint applicability",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-checkpoint-commit.test.ts",
        testId:
          "INV-CHECKPOINT-01 commits immutable snapshot, group, and checkpoint atomically",
      },
    ],
  ],
  [
    "INV-BARRIER-01",
    4,
    "wait-group state and continuation",
    [
      {
        file: "packages/workbench-server/test/domains/runs/wait-group-state.test.ts",
        testId: "INV-BARRIER-01 consumes continuation exactly once",
      },
    ],
  ],
  [
    "INV-AGENT-01",
    4,
    "independent child lifecycle",
    [
      {
        file: "packages/workbench-server/test/domains/agents/canonical-child-execution-replay.test.ts",
        testId:
          "INV-AGENT-01 replays a completed child result without redispatch",
      },
      {
        file: "packages/workbench-server/test/domains/agents/canonical-explore-execution.test.ts",
        testId:
          "INV-AGENT-01 executes Explore in an independent canonical conversation",
      },
    ],
  ],
  [
    "INV-EFFECT-01",
    5,
    "tool replay capability and effect identity",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-effect-claim-commit.test.ts",
        testId:
          "INV-EFFECT-01 INV-CLAIM-01 atomically authorizes an effect and claims its attempt",
      },
    ],
  ],
  [
    "INV-CLAIM-01",
    5,
    "attempt claim fencing",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-effect-claim-commit.test.ts",
        testId:
          "INV-EFFECT-01 INV-CLAIM-01 atomically authorizes an effect and claims its attempt",
      },
    ],
  ],
  [
    "INV-RECOVERY-01",
    5,
    "evidence-bearing recovery actions",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-provider-retry.test.ts",
        testId: "records known failure before scheduling canonical retry",
      },
    ],
  ],
  [
    "INV-PROVIDER-01",
    5,
    "durable provider phases",
    [
      {
        file: "packages/workbench-server/test/domains/runs/provider-phase-state.test.ts",
        testId:
          "INV-PROVIDER-01 commits a complete prepared response instead of regenerating",
      },
    ],
  ],
  [
    "INV-ARTIFACT-01",
    5,
    "artifact preparation and retention",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-managed-artifact-finalizer.test.ts",
        testId:
          "INV-ARTIFACT-01 finalizes verified bytes inside the canonical owner root",
      },
    ],
  ],
  [
    "INV-VIEW-01",
    7,
    "projection watermarks and rebuild",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-timeline-page-service.test.ts",
        testId: "INV-PAGE-01 INV-VIEW-01 pages fixed projection snapshots",
      },
    ],
  ],
  [
    "INV-PAGE-01",
    7,
    "fixed-view pagination",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-timeline-page-service.test.ts",
        testId: "INV-PAGE-01 INV-VIEW-01 pages fixed projection snapshots",
      },
    ],
  ],
  [
    "INV-CONTEXT-01",
    3,
    "branch-safe context boundaries",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-auto-compaction-service.test.ts",
        testId:
          "INV-CONTEXT-01 stale prepared summaries create no provider phase or work",
      },
    ],
  ],
  [
    "INV-DELIVERY-01",
    7,
    "at-least-once delivery reconciliation",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-deletion-service.test.ts",
        testId:
          "INV-DELETE-01 INV-DELIVERY-01 fences dispatch and publishes deletion exactly once",
      },
    ],
  ],
  [
    "INV-POLICY-01",
    6,
    "file authority and fresh evaluation",
    [
      {
        file: "packages/workbench-server/test/infrastructure/persistence/unified-policy-commit.test.ts",
        testId:
          "INV-POLICY-01 persists file-authoritative observations and partial save outcomes",
      },
    ],
  ],
  [
    "INV-POLICY-02",
    6,
    "invalid overlay recovery",
    [
      {
        file: "packages/workbench-server/test/domains/permissions/permission-policy-service.test.ts",
        testId: "quarantine failure leaves the authoritative overlay unchanged",
      },
    ],
  ],
  [
    "INV-POLICY-03",
    6,
    "invalid rule-set fallback",
    [
      {
        file: "packages/workbench-server/test/domains/permissions/canonical-policy-fallback-coordinator.test.ts",
        testId:
          "INV-POLICY-03 requires a durable explicit Baseline-without-overlays decision",
      },
    ],
  ],
  [
    "INV-POLICY-04",
    6,
    "remembered-save partial outcomes",
    [
      {
        file: "packages/workbench-server/test/domains/permissions/permission-policy-service.test.ts",
        testId:
          "INV-POLICY-04 prepared remembered saves never overwrite external edits",
      },
    ],
  ],
  [
    "INV-BACKUP-01",
    8,
    "complete portable backup",
    [
      {
        file: "packages/workbench-server/test/domains/storage/canonical-portable-backup-service.test.ts",
        testId:
          "INV-BACKUP-01 creates a verified canonical database and policy snapshot",
      },
    ],
  ],
  [
    "INV-DELETE-01",
    8,
    "deletion finalization and replay evidence",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-deletion-service.test.ts",
        testId:
          "INV-DELETE-01 INV-DELIVERY-01 fences dispatch and publishes deletion exactly once",
      },
    ],
  ],
  [
    "INV-RESTORE-01",
    8,
    "restore incarnation fencing",
    [
      {
        file: "packages/workbench-server/test/infrastructure/storage-bootstrap/home-promotion.test.ts",
        testId:
          "INV-RESTORE-01 promotes a verified sibling home only during startup",
      },
    ],
  ],
  [
    "INV-MIGRATE-01",
    9,
    "new-only restart-safe migration",
    [
      {
        file: "packages/workbench-server/test/infrastructure/migrations/unified-timeline-import.test.ts",
        testId:
          "INV-MIGRATE-01 imports a branching legacy history in restart-safe bounded batches",
      },
    ],
  ],
  [
    "INV-MIGRATE-02",
    9,
    "source authority proof fixtures",
    [
      {
        file: "packages/workbench-server/test/infrastructure/migrations/post0012-timeline-reader.test.ts",
        testId:
          "INV-MIGRATE-02 reads a strict digest-bound post-0012 timeline source",
      },
    ],
  ],
  [
    "INV-PERF-01",
    10,
    "boundedness and latency smoke",
    [
      {
        file: "packages/workbench-server/test/domains/conversations/canonical-timeline-latency.test.ts",
        testId: "INV-PERF-01",
      },
    ],
  ],
  [
    "INV-COVERAGE-01",
    10,
    "coverage manifest audit",
    [
      {
        file: "packages/workbench-server/test/invariants/unified-timeline-coverage.test.ts",
        testId:
          "INV-COVERAGE-01 maps every owning unified-timeline invariant once",
      },
    ],
  ],
] as const satisfies readonly (readonly [
  string,
  number,
  string,
  readonly UnifiedTimelineEvidence[],
])[];

export type UnifiedTimelineInvariantId =
  (typeof unifiedTimelineInvariantCoverage)[number][0];

export const unifiedTimelineMutationInventory = [
  ["conversation_create_or_import", "history_imported"],
  ["accepted_user_input_and_run_start", "entries_appended"],
  ["assistant_response_and_tool_proposals", "entries_appended"],
  ["tool_result_attachment", "entries_appended"],
  ["child_result_attachment", "entries_appended"],
  ["human_answer_approval_or_review", "interaction_changed"],
  ["cross_conversation_plan_acceptance", "interaction_changed"],
  ["navigation", "selection_changed"],
  ["summary_or_context_recipe", "context_boundary_committed"],
  ["run_lifecycle", "run_changed"],
  ["policy_authorization_or_claim", "execution_changed"],
  ["remembered_policy_save", "policy_save_intent"],
  ["recovery_or_abandonment", "execution_changed"],
  ["deletion", "deletion_intent"],
  ["stream_progress_heartbeat_or_log", "non_history"],
  ["queued_input_during_active_run", "non_history"],
] as const;
