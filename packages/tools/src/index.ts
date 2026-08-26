export * from "./result-projection/index.js";
import type { ToolDescriptor, ToolName, ToolRisk } from "@nervekit/contracts";
import {
  allToolDescriptorsFromDefinitions,
  coreToolDescriptorsFromDefinitions,
  coreToolRiskForName,
} from "./catalog/index.js";

export { confluenceToolDefinitions } from "./catalog/core/confluence.tools.js";
export { filesystemToolDefinitions } from "./catalog/core/filesystem.tools.js";
export { interactionToolDefinitions } from "./catalog/core/interaction.tools.js";
export { jiraToolDefinitions } from "./catalog/core/jira.tools.js";
export { pythonToolDefinitions } from "./catalog/core/python.tools.js";
export { shellToolDefinitions } from "./catalog/core/shell.tools.js";
export { webToolDefinitions } from "./catalog/core/web.tools.js";
export {
  allToolDescriptorsFromDefinitions,
  coreToolDescriptorsFromDefinitions,
} from "./catalog/descriptors.js";
export { coreToolDefinitionByName } from "./catalog/index.js";
export {
  allToolDefinitions,
  classifyToolRisk,
  coreToolDefinitions,
  hostToolDefinitions,
  isHostToolName,
  isLocalToolName,
  localToolDefinitions,
  orchestrationToolDefinitions,
  requireToolDefinition,
  toolDefinitionByName,
  toolDefinitionsByGroup,
  toolGroups,
  toolHasTrait,
  toolManifest,
} from "./catalog/manifest.js";
export { normalizeToolArguments } from "./catalog/normalize-arguments.js";
export { exploreToolDefinitions } from "./catalog/orchestration/explore.tools.js";
export { planModeToolDefinitions } from "./catalog/orchestration/plan-mode.tools.js";
export { taskToolDefinitions } from "./catalog/orchestration/task.tools.js";
export { promptGuidelinesForTools } from "./catalog/prompt-guidelines.js";
export {
  coreToolRiskForName,
  isReadOnlyNetworkToolForApproval,
} from "./catalog/risk.js";
export {
  type CoreToolExecutionMode,
  type HostToolDefinition,
  type LocalToolDefinition,
  type ToolArgumentRiskClassifier,
  type ToolDefinition,
  type ToolDefinitionMetadata,
  type ToolExecutor,
  type ToolPermissionTargetDescriptor,
  defineTool,
  isHostToolDefinition,
  isLocalToolDefinition,
} from "./catalog/types.js";
export { resolveCommandCwd } from "./execution/common/command-cwd.js";
export { LiveOutputDelivery } from "./execution/common/live-output.js";
export {
  type BoundedTextResult,
  type ContentBlockLike,
  FILE_OUTPUT_MAX_LINE_CHARS,
  LIVE_OUTPUT_MAX_BYTES,
  LIVE_OUTPUT_MAX_LINES,
  LIVE_OUTPUT_MAX_LINE_CHARS,
  MODEL_TEXT_MAX_LINES,
  MODEL_TEXT_MAX_LINE_CHARS,
  MODEL_TOOL_RESULT_MAX_BYTES,
  PROCESS_INLINE_MAX_LINE_CHARS,
  type TextBoundaryDetails,
  type TextBudget,
  appendBoundedTextNotice,
  boundContentBlocks,
  boundText,
  splitLiveOutputChunks,
  textBoundaryDetails,
  textLimitSnapshot,
} from "./execution/common/output-budget.js";
export {
  buildProcessResult,
  buildProcessTextResult,
} from "./execution/common/process-result.js";
export { ToolExecutionError } from "./execution/common/tool-error.js";
export { executeTool } from "./execution/dispatch.js";
export {
  type ExecutableLocatorOptions,
  type ExecutablePlatform,
  type ExecutableRunOptions,
  type ExecutableRunResult,
  type ResolvedExecutable,
  executableSearchDirectories,
  locateExecutable,
  runExecutable,
  spawnExecutable,
} from "./execution/executable/executable.js";
export { normalizeEditArgs } from "./execution/filesystem/edit-args.js";
export { executeEdit } from "./execution/filesystem/edit.js";
export { resolveToolPath } from "./execution/filesystem/path.js";
export {
  type PythonRuntime,
  type PythonRuntimeStatus,
  resolvePythonRuntime,
} from "./execution/python/runtime.js";
export { executeBash } from "./execution/shell/bash.js";
export {
  type ResolveBashShellConfigOptions,
  type ShellConfig,
  resolveBashShellConfig,
} from "./execution/shell/shell-config.js";
export {
  type GitBranchServicePort,
  type GitRefSnapshot,
  baseBranchFromRefSnapshot,
  branchExists,
  comparisonBaseRef,
  comparisonBaseRefFromSnapshot,
  detectBaseBranch,
  listBranches,
  mergedToBase,
  readRefSnapshot,
  refSnapshotFromRead,
} from "./git/git-branches.js";
export {
  type ExecResult,
  GitCommandError,
  runGitCommand,
} from "./git/git-command.js";
export { GitWorkflowError } from "./git/git-errors.js";
export {
  type GithubCheckRunRaw,
  type GithubRepositoryRef,
  isGithubRemoteUrl,
  noChecksSummary,
  parseGitRemoteUrls,
  parseGithubChecks,
  parseGithubRepositoryRemote,
  parseGithubRepositoryUrl,
  summarizeChecks,
  summarizeStatusCheckRollup,
} from "./git/git-github-parsers.js";
export {
  type GithubServiceContext,
  allowedMergeMethods,
  checkoutPr,
  githubPrSearch,
  githubStatus,
  listOpenPrs,
  mergePr,
  prChecks,
  prCommits,
  prConversation,
  prCore,
  prFileDiff,
  prFiles,
  prInitial,
  prOverview,
} from "./git/git-github-service.js";
export {
  type GitCommandObservation,
  type GitOverviewObservation,
  type GitReadObservation,
  type GitServiceOptions,
  type GitWorkspaceRef,
  type GithubRequestObservation,
} from "./git/git-observability.js";
export { GitService } from "./git/git-service.js";
export {
  type PorcelainBranchInfo,
  type PorcelainStatus,
  parsePorcelainV2,
  parseShortstat,
} from "./git/git-status.js";

export { evaluateToolPermission } from "./policy/evaluate-tool-permission.js";
export {
  type ToolSupervisionInput,
  evaluateToolSupervision,
} from "./policy/evaluate-tool-supervision.js";
export {
  escapeGlobLiteral,
  pathGlobMatches,
  patternMatches,
  validateCommandGlob,
  validatePathGlob,
  validatePattern,
  validateUrlGlob,
} from "./policy/path-glob.js";
export {
  coveringAllowExceptions,
  deduplicatePermissionExceptions,
  matchingDenyExceptions,
  permissionExceptionId,
  permissionExceptionKey,
  suggestedPermissionExceptions,
  withPermissionExceptionId,
} from "./policy/permission-exceptions.js";
export { permissionTargets } from "./policy/permission-targets.js";
export { assessShellCommand } from "./policy/shell/assessment.js";
export {
  hasDangerousCommandPattern,
  isAllowedPlanModeBashCommand,
  isBlockedCommandSegment,
  isLikelyLongRunningCommand,
} from "./policy/shell/plan-mode.js";
export { assessToolRisk } from "./policy/tool-risk-assessment.js";
export {
  type PermissionTarget,
  type ShellCommandAssessment,
  type ShellCommandSegmentAssessment,
  type ToolPermissionEvaluation,
  type ToolPermissionInput,
  type ToolPolicyConstraint,
  type ToolRiskAssessment,
} from "./policy/types.js";
export {
  type ToolAvailability,
  resolveToolAvailability,
} from "./runtime/availability.js";
export {
  type ToolDispatcher,
  type ToolDispatcherOptions,
  createToolDispatcher,
} from "./runtime/dispatcher.js";
export {
  type TodoItem,
  optionalString,
  parseExploreRequest,
  parsePlanRequest,
  parseQuestion,
  parseTaskSelector,
  parseTodos,
  requiredString,
} from "./runtime/orchestration/args.js";
export {
  type ExplorePort,
  createExploreHandlers,
} from "./runtime/orchestration/explore.js";
export {
  type InteractionPort,
  createInteractionHandlers,
} from "./runtime/orchestration/interaction.js";
export {
  type PlanPort,
  createPlanHandlers,
} from "./runtime/orchestration/plans.js";
export {
  boundedSummary,
  contentResult,
  formatTodoSummary,
} from "./runtime/orchestration/results.js";
export {
  type TaskToolName,
  type TaskToolPort,
  createTaskHandlers,
} from "./runtime/orchestration/tasks.js";
export {
  type TodoPort,
  createTodoHandlers,
} from "./runtime/orchestration/todos.js";
export { evaluateRuntimeToolPermission } from "./runtime/runtime-tool-permission.js";
export {
  type RuntimeToolPermissionInput,
  type ToolAvailabilityInput,
  type ToolDecision,
  type ToolDecisionKind,
  type ToolHandler,
  type ToolHandlerContext,
  type ToolHandlerRegistry,
  type ToolLifecycleHooks,
  ToolRuntimeError,
  ToolUnavailableError,
  ToolValidationError,
} from "./runtime/types.js";
export {
  type BashToolArgs,
  type ConfluenceToolArgs,
  type EditToolArgs,
  type ExplainImageRequest,
  type ExplainImageResponse,
  type ExplainImageToolArgs,
  type FindToolArgs,
  type GrepToolArgs,
  type JiraToolArgs,
  type LsToolArgs,
  type PythonToolArgs,
  type ReadToolArgs,
  type ToolContentBlock,
  type ToolExecutionContext,
  type ToolExecutionOutputUpdate,
  type ToolExecutionResult,
  type ToolImageContent,
  type ToolPathArgs,
  type ToolTextContent,
  type WebFetchToolArgs,
  type WebSearchToolArgs,
  type WriteToolArgs,
} from "./types.js";

export const coreToolDescriptors: ToolDescriptor[] =
  coreToolDescriptorsFromDefinitions();

export const allToolDescriptors: ToolDescriptor[] =
  allToolDescriptorsFromDefinitions();

export function toolRiskForName(name: ToolName): ToolRisk {
  return coreToolRiskForName(name);
}
