const migrationPath =
  "packages/workbench-server/src/infrastructure/migrations/unified-timeline/";
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
    !file.startsWith(
      "packages/workbench-server/src/infrastructure/migrations/",
    ) &&
    file !==
      "packages/workbench-server/src/infrastructure/storage-bootstrap/initialize.ts" &&
    text.includes("infrastructure/migrations/unified-timeline")
  ) {
    violations.push(
      "target runtime must not import unified-timeline source readers",
    );
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
  if (file.startsWith(timelineRuntimeRoot)) {
    for (const symbol of retiredAuthoritySymbols) {
      if (text.includes(symbol)) {
        violations.push(`canonical timeline uses retired authority: ${symbol}`);
      }
    }
  }
  if (file.startsWith(migrationPath) && /export\s+\*.*domains\//.test(text)) {
    violations.push(
      "migration source readers must not be re-exported as runtime domains",
    );
  }
  return violations;
}
