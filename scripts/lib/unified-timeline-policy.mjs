const migrationPath =
  "packages/workbench-server/src/infrastructure/migrations/unified-timeline/";
const serverRuntimeRoot = "packages/workbench-server/src/";
const timelineRuntimeRoot =
  "packages/workbench-server/src/domains/conversations/timeline/";

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
    text.includes("infrastructure/migrations/unified-timeline")
  ) {
    violations.push(
      "target runtime must not import unified-timeline source readers",
    );
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
