const migrationPath =
  "packages/workbench-server/src/infrastructure/migrations/unified-timeline/";
const allMigrationsPath =
  "packages/workbench-server/src/infrastructure/migrations/";
const serverRuntimeRoot = "packages/workbench-server/src/";
const timelineRuntimeRoot =
  "packages/workbench-server/src/domains/conversations/timeline/";

const productionCompositionRoots = [
  "packages/workbench-server/src/app/bootstrap/",
  "packages/workbench-server/src/app/runtime/",
  "packages/workbench-server/src/adapters/protocol/",
];
const retiredRuntimeImports = [
  "conversation-journal.repository",
  "conversation-repository",
  "conversation-harness-storage",
  "conversation-service",
  "/workbench-run.service",
  "run-composition",
  "tool-call.repository",
  "ToolService",
  "MessageMirror",
  "SubagentRunner",
  "openChildStorage",
  "WorkbenchSubagentExecutions",
];

const fullyRetiredRuntimeSymbols = [
  "MessageMirror",
  "run-composition",
  "/workbench-run.service",
  "run-transition.repository",
  "/human-input/",
  "/tool-service",
  "inline-command-runner",
  "sequential-tool-approval-batch",
  "prompt-block-expansion",
  "ConversationJournalRepository",
  "ConversationHarnessStorage",
  "class ToolService",
  "class WorkbenchRunService",
];

const migrationOnlySymbols = [
  "CanonicalMigrationStore",
  ".migration.listConversationMetadata",
  ".migration.readConversationEntries",
  ".migration.retireLegacyRuntimeAuthority",
  "ConversationJournalRepository",
  "ConversationHarnessStorage",
];

const legacyLifecycleSymbols = [
  "run_lifecycle_records",
  "lifecycle_execution_attempts",
  "lifecycle_tool_proposals",
  "conversation_journal_head",
  "conversation_journal_commit",
];

const retiredAuthoritySymbols = [
  "model_context.entry_appended",
  "model_context.leaf_changed",
  "transcriptCursor",
  "harnessLeafId",
  "harnessSavePointId",
];

export function unifiedTimelinePolicyViolations(file, text) {
  const violations = [];
  if (
    file.startsWith(serverRuntimeRoot) &&
    !file.startsWith(allMigrationsPath) &&
    file !==
      "packages/workbench-server/src/infrastructure/storage-bootstrap/initialize.ts" &&
    text.includes("infrastructure/migrations/unified-timeline")
  ) {
    violations.push(
      "target runtime must not import unified-timeline source readers",
    );
  }
  if (
    file.startsWith(serverRuntimeRoot) &&
    !file.startsWith("packages/workbench-server/src/infrastructure/migrations/")
  ) {
    for (const symbol of fullyRetiredRuntimeSymbols) {
      if (text.includes(symbol)) {
        violations.push(`target runtime uses retired authority: ${symbol}`);
      }
    }
  }
  if (productionCompositionRoots.some((root) => file.startsWith(root))) {
    for (const symbol of retiredRuntimeImports) {
      if (text.includes(symbol)) {
        violations.push(
          `production composition uses retired authority: ${symbol}`,
        );
      }
    }
  }
  if (productionCompositionRoots.some((root) => file.startsWith(root))) {
    for (const symbol of migrationOnlySymbols) {
      if (text.includes(symbol)) {
        violations.push(
          `production composition reaches a migration-only facet: ${symbol}`,
        );
      }
    }
  }
  if (
    file.startsWith("packages/workbench-server/src/domains/") &&
    !file.endsWith("/canonical-tool-settlement.service.ts") &&
    !file.endsWith("/canonical-interaction-resolution.service.ts") &&
    /attachmentDisposition:\s*["']attached["']/.test(text)
  ) {
    violations.push(
      "parent wait-member attachment belongs to canonical settlement",
    );
  }
  if (
    (file.startsWith("packages/workbench-server/src/domains/") ||
      productionCompositionRoots.some((root) => file.startsWith(root))) &&
    !file.startsWith(allMigrationsPath)
  ) {
    for (const symbol of legacyLifecycleSymbols) {
      if (text.includes(symbol)) {
        violations.push(
          `runtime references legacy lifecycle authority: ${symbol}`,
        );
      }
    }
  }
  if (file.startsWith(timelineRuntimeRoot)) {
    for (const symbol of retiredAuthoritySymbols) {
      if (text.includes(symbol)) {
        violations.push(`canonical timeline uses retired authority: ${symbol}`);
      }
    }
  }
  if (
    file.startsWith(serverRuntimeRoot) &&
    !file.includes("/infrastructure/persistence/canonical-sqlite/") &&
    !file.includes("/infrastructure/migrations/") &&
    !file.includes("/infrastructure/persistence/query-cache/") &&
    file !==
      "packages/workbench-server/src/domains/storage/canonical-restore-staging.service.ts" &&
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:conversation_entries|conversation_transitions|conversations|run_controls|provider_phases|wait_groups|logical_effects|execution_attempts)\b/i.test(
      text,
    )
  ) {
    violations.push(
      "canonical timeline tables may only be written by owner persistence modules",
    );
  }
  if (file.startsWith(migrationPath) && /export\s+\*.*domains\//.test(text)) {
    violations.push(
      "migration source readers must not be re-exported as runtime domains",
    );
  }
  return violations;
}
