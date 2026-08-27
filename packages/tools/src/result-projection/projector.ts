import type {
  AgentResultProfileId,
  AgentResultStrategyId,
} from "@nervekit/contracts";
import { conservativeFallbackCandidate } from "./fallback.js";
import { measureBlocks } from "./measure.js";
import {
  artifactIndex,
  compactDiagnosticIndex,
  compoundPerTask,
  continuationAwareHead,
  headTailText,
  headText,
  itemAwareHead,
  tailText,
  taskLogWindow,
  terminalOutcome,
  unchangedIfFits,
  type StrategyProjection,
} from "./strategies.js";
import type {
  AgentResultPolicy,
  CandidateContext,
  ProjectedToolResult,
  ProjectionCandidate,
} from "./types.js";

export function projectAgentResult(
  context: CandidateContext,
  policy?: AgentResultPolicy,
): ProjectedToolResult {
  const terminal = hasTerminalOutcomePrecedence(context);
  let profile: AgentResultProfileId;
  let candidate: ProjectionCandidate;
  let strategy: AgentResultStrategyId;

  if (terminal) {
    profile = "terminal_outcome";
    strategy = "terminal_outcome";
    candidate = terminalCandidate(context, policy);
  } else {
    try {
      profile = policy
        ? typeof policy.profile === "function"
          ? policy.profile(context)
          : policy.profile
        : "conservative_fallback";
      strategy = policy?.overflow ?? "head";
      candidate =
        policy?.buildCandidate(context) ??
        conservativeFallbackCandidate(context);
    } catch {
      profile = "conservative_fallback";
      strategy = "head";
      candidate = conservativeFallbackCandidate(context);
    }
  }

  const original = measureBlocks(candidate.blocks);
  const fitting =
    strategy === "compound_per_task" && candidate.tasks
      ? undefined
      : unchangedIfFits(candidate, profile);
  let projection: StrategyProjection;
  const fastPath = fitting !== undefined;
  let usedStrategy: AgentResultStrategyId = "unchanged";
  let perTask:
    | Array<{
        index: number;
        decision: "inline" | "index" | "outcome";
        displayedBytes: number;
        displayedLines: number;
      }>
    | undefined;

  if (fitting) {
    projection = fitting;
  } else if (strategy === "compound_per_task" && candidate.tasks) {
    const projections: StrategyProjection[] = [];
    perTask = [];
    for (const task of candidate.tasks) {
      const fit = unchangedIfFits(task.candidate, "delegated_reports");
      const selected =
        fit ?? artifactIndex(task.candidate, "delegated_reports");
      projections.push(selected);
      const measured = measureBlocks(selected.blocks);
      perTask.push({
        index: task.index,
        decision: fit ? "inline" : "index",
        displayedBytes: measured.bytes,
        displayedLines: measured.lines,
      });
    }
    projection = compoundPerTask(projections);
    usedStrategy = "compound_per_task";
  } else {
    projection = applyStrategy(strategy, candidate, profile);
    usedStrategy = strategy;
  }

  const displayed = measureBlocks(projection.blocks);
  const availableRecovery = candidate.artifacts.find(
    (artifact) =>
      artifact.availability === "available" &&
      (artifact.role === "primary_result" ||
        artifact.role === "overflow_recovery"),
  );
  const recovery = fastPath
    ? "none"
    : availableRecovery?.id === "complete_payload"
      ? "complete_payload"
      : availableRecovery
        ? "artifact"
        : "none";

  return {
    blocks: projection.blocks,
    snapshot: {
      version: 1,
      profile,
      strategy: usedStrategy,
      terminalOutcomePrecedence: terminal,
      fastPath,
      recovery,
      artifactRoles: [
        ...new Set(candidate.artifacts.map((artifact) => artifact.role)),
      ],
      counts: projection.counts,
      originalTextBytes: original.bytes,
      displayedTextBytes: displayed.bytes,
      originalTextLines: original.lines,
      displayedTextLines: displayed.lines,
      ...(perTask ? { perTask } : {}),
      ...((projection.continuation ?? candidate.continuation)?.length
        ? { continuation: projection.continuation ?? candidate.continuation }
        : {}),
    },
  };
}

export function hasTerminalOutcomePrecedence(
  context: CandidateContext,
): boolean {
  return (
    context.status === "denied" ||
    context.status === "failed" ||
    context.status === "cancelled" ||
    context.phase === "interrupted" ||
    context.errorDetails?.code === "interrupted"
  );
}

function applyStrategy(
  strategy: AgentResultStrategyId,
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  switch (strategy) {
    case "tail":
      return tailText(candidate, profile);
    case "head_tail":
      return headTailText(candidate, profile);
    case "item_aware":
      return itemAwareHead(candidate, profile);
    case "continuation_aware":
      return continuationAwareHead(candidate, profile);
    case "compact_diagnostic":
      return compactDiagnosticIndex(candidate, profile);
    case "artifact_index":
      return artifactIndex(candidate, profile);
    case "task_log_window":
      return taskLogWindow(candidate);
    case "terminal_outcome":
      return terminalOutcome(candidate);
    case "unchanged":
    case "head":
    default:
      return headText(candidate, profile);
  }
}

function terminalCandidate(
  context: CandidateContext,
  policy?: AgentResultPolicy,
): ProjectionCandidate {
  const reason =
    context.errorDetails?.message ??
    context.error ??
    "No further diagnostic was supplied.";
  const resource = policy?.terminalResource?.(context);
  const interrupted =
    context.phase === "interrupted" ||
    context.errorDetails?.code === "interrupted";
  const headline =
    context.status === "denied"
      ? "User denied the requested tool call. The operation was not performed."
      : interrupted
        ? "Tool execution was interrupted. No rollback is implied."
        : context.status === "cancelled"
          ? "Tool execution was cancelled. No rollback is implied."
          : "Tool execution failed.";
  const lines = [
    headline,
    `Tool: ${context.toolName}`,
    `Reason: ${reason}`,
    resource
      ? `Resource: ${resource.label}${resource.state ? ` (${resource.state})` : ""}`
      : undefined,
    "Next action: inspect the reason, adjust the request if appropriate, and retry only when safe.",
  ].filter((line): line is string => Boolean(line));
  return {
    blocks: [{ type: "text", text: lines.join("\n") }],
    artifacts: [
      ...context.validatedArtifacts,
      ...(context.completePayload ? [context.completePayload] : []),
    ],
  };
}
