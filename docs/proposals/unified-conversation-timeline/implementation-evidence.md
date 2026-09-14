# Unified timeline implementation evidence

This index maps executable evidence to the proposal invariants. It is additive: the invariant definitions in this directory remain authoritative.

| Invariant                                     | Primary executable evidence                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-AUTH-01, INV-COMMIT-01, INV-RECEIPT-01    | `canonical-store.test.ts`, `canonical-run-start-service.test.ts`                                                                                                                      |
| INV-ENTRY-01, INV-HEAD-01, INV-SELECT-01      | `canonical-store.test.ts`, `canonical-navigation-service.test.ts`                                                                                                                     |
| INV-RUN-01, INV-CHECKPOINT-01, INV-BARRIER-01 | `canonical-run-start-service.test.ts`, `canonical-run-timeline-service.test.ts`, `conversation-runtime.test.ts`                                                                       |
| INV-EFFECT-01, INV-CLAIM-01, INV-RECOVERY-01  | `canonical-provider-preparation-service.test.ts`, `canonical-provider-retry.test.ts`, `canonical-tool-batch.test.ts`                                                                  |
| INV-CONTEXT-01                                | `canonical-compaction-coordinator.test.ts`, `canonical-auto-compaction-service.test.ts` (stale-summary admission fencing and zero provider work)                                      |
| INV-POLICY-01..04                             | `permission-policy-service.test.ts`, `policy-save-recovery.test.ts`                                                                                                                   |
| INV-ARTIFACT-01                               | `canonical-managed-artifact-finalizer.test.ts`, `canonical-portable-backup-service.test.ts`                                                                                           |
| INV-AGENT-01                                  | `canonical-explore-execution.test.ts` (independent child, nested canonical tool continuation, durable relationship)                                                                   |
| INV-BACKUP-01, INV-RESTORE-01                 | `canonical-portable-backup-service.test.ts`, `home-promotion.test.ts` (normal and interrupted rename recovery)                                                                        |
| INV-MIGRATE-01, INV-MIGRATE-02                | `current-home-timeline-migration.test.ts`, `legacy-v2-home-migration.test.ts`                                                                                                         |
| INV-DELETE-01, INV-DELIVERY-01                | `canonical-deletion-service.test.ts`, `conversation-deletion.test.ts`                                                                                                                 |
| INV-OUTCOME-01, INV-VIEW-01, INV-PAGE-01      | `canonical-timeline-page-service.test.ts` (including access denial), `timeline-reconciliation.test.ts`, `canonical-timeline-projection.test.ts`, `canonical-timeline-latency.test.ts` |

## Static authority evidence

`scripts/lib/unified-timeline-policy.mjs` rejects fully retired symbols across target runtime source, retired production-composition imports, and direct writes to canonical authority tables outside owner persistence and versioned migration/restore modules. `scripts/check-package-boundaries.mjs` runs this policy as part of `pnpm check`.

## Bounded-history smoke

`canonical-timeline-latency.test.ts` seeds 2,000 immutable entries in bounded commits, requests 30 fixed-view pages of 50 entries, verifies the structural result bound, and applies a conservative 250 ms absolute p95 budget. Queue and transaction instrumentation remain separate production diagnostics rather than being conflated with page latency.

## Validation

All tests use fresh homes under the operating-system temporary directory. The release gate is:

```sh
pnpm fix && pnpm check && pnpm run test:full
```
