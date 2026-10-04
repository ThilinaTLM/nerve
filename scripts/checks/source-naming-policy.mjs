import { posix } from "node:path";

export const GENERIC_SOURCE_NAME_EXCEPTIONS = new Set([
  "packages/contracts/src/domains/auth/operations.ts",
  "packages/contracts/src/domains/completions/operations.ts",
  "packages/contracts/src/domains/conversations/operations.ts",
  "packages/contracts/src/domains/filesystem/operations.ts",
  "packages/contracts/src/domains/git/operations.ts",
  "packages/contracts/src/domains/logs/operations.ts",
  "packages/contracts/src/domains/models/operations.ts",
  "packages/contracts/src/domains/projects/operations.ts",
  "packages/contracts/src/domains/prompt-suggestions/operations.ts",
  "packages/contracts/src/domains/providers/operations.ts",
  "packages/contracts/src/domains/scratch-notes/operations.ts",
  "packages/contracts/src/domains/settings/operations.ts",
  "packages/contracts/src/domains/skills/operations.ts",
  "packages/contracts/src/domains/snapshots/operations.ts",
  "packages/contracts/src/domains/status/operations.ts",
  "packages/contracts/src/domains/storage/operations.ts",
  "packages/contracts/src/domains/task-definitions/operations.ts",
  "packages/contracts/src/domains/tasks/operations.ts",
  "packages/contracts/src/domains/tools/operations.ts",
  "packages/contracts/src/domains/usage/operations.ts",
  "packages/desktop-shell/src/daemon/composition.ts",
  "packages/harness/src/harness/maintenance/operations.ts",
  "packages/harness/src/harness/queue/operations.ts",
  "packages/tools/src/execution/confluence/operations.ts",
  "packages/tools/src/git/read/types.ts",
  "packages/tools/src/policy/types.ts",
  "packages/tools/src/result-projection/types.ts",
  "packages/tools/src/runtime/types.ts",
  "packages/ui-kit/src/lib/utils.ts",
  "packages/workbench-server/src/domains/tools/permission/types.ts",
]);

const genericBasenames = new Set([
  "types.ts",
  "state.ts",
  "helpers.ts",
  "utils.ts",
  "operations.ts",
  "composition.ts",
]);

export function sourceNamingPolicyViolation(file) {
  const normalized = file.split("\\").join("/");
  if (!/^packages\/[^/]+\/src\//.test(normalized)) return undefined;
  if (!genericBasenames.has(posix.basename(normalized))) return undefined;
  if (GENERIC_SOURCE_NAME_EXCEPTIONS.has(normalized)) return undefined;
  return "generic production source name is not in the reviewed cohesive-exception inventory";
}
