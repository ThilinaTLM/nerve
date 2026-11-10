import type {
  AgentResultProfileId,
  AgentResultStrategyId,
} from "@nervekit/contracts/tools";
import { conservativeFallbackCandidate } from "./fallback.js";
import { measureBlocks } from "./measure.js";
import {
  artifactIndex,
  continuationAwareHead,
  headTailText,
  headText,
  itemAwareHead,
  tailText,
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
  const fitting = unchangedIfFits(candidate, profile);
  let projection: StrategyProjection;
  const fastPath = fitting !== undefined;
  let usedStrategy: AgentResultStrategyId = "unchanged";

  if (fitting) {
    projection = fitting;
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
    case "artifact_index":
      return artifactIndex(candidate, profile);

    case "terminal_outcome":
      return terminalOutcome(candidate);
    case "unchanged":
    case "head":
    default:
      return headText(candidate, profile);
  }
}

const ERRNO_WORDING: Record<string, string> = {
  ENOENT: "path not found",
  EACCES: "permission denied",
  EISDIR: "is a directory",
  ENOTDIR: "not a directory",
};

/** Plain wording for the common filesystem errno messages, e.g. `ENOENT: no such file or directory, open '/x'`. */
function plainReason(reason: string, resource?: string): string {
  // libuv has no name for EDQUOT, so Node reports a full disk quota as "Unknown system error -122".
  if (/Unknown system error -122\b/.test(reason))
    return "disk quota exceeded; cannot write";
  const code = /\b(ENOENT|EACCES|EISDIR|ENOTDIR)\b/.exec(reason)?.[1];
  if (!code) return reason;
  const path = /'([^']+)'/.exec(reason)?.[1] ?? resource;
  return `${ERRNO_WORDING[code]}${path ? `: ${path}` : ""}`;
}

/** Drops a leading tool name the reason repeats, so `read: read path not found` becomes `read: path not found`. */
function withoutToolPrefix(reason: string, toolName: string): string {
  const match = new RegExp(`^${toolName}(?::\\s*|\\s+)(?=\\S)`, "i").exec(
    reason,
  );
  return match ? reason.slice(match[0].length) : reason;
}

function terminalCandidate(
  context: CandidateContext,
  policy?: AgentResultPolicy,
): ProjectionCandidate {
  const resource = policy?.terminalResource?.(context)?.label;
  const raw = String(context.errorDetails?.message ?? context.error ?? "");
  const reason = withoutToolPrefix(
    plainReason(raw.trim(), resource),
    context.toolName,
  );
  const interrupted =
    context.phase === "interrupted" ||
    context.errorDetails?.code === "interrupted";
  let text: string;
  if (context.status === "denied") {
    // The denial keeps who refused and that nothing ran; a user's refusal needs no further reason.
    text =
      context.denialSource === "user"
        ? "denied by user, not run."
        : `${context.denialSource === "policy" ? "denied by policy, not run." : "denied, not run."}${reason ? ` ${reason}` : ""}`;
  } else if (interrupted || context.status === "cancelled") {
    text = `${interrupted ? "interrupted" : "cancelled"}, no rollback implied.${reason ? ` ${reason}` : ""}`;
  } else {
    text = reason || "failed.";
    // Show the resource only when the reason does not already name it.
    if (
      resource &&
      !text.includes(resource) &&
      !argumentValues(context.args).has(resource)
    )
      text += ` (${resource})`;
  }
  return {
    blocks: [{ type: "text", text: `${context.toolName}: ${text}` }],
    artifacts: [
      ...context.validatedArtifacts,
      ...(context.completePayload ? [context.completePayload] : []),
    ],
  };
}

function argumentValues(args: unknown): Set<string> {
  return new Set(
    args && typeof args === "object"
      ? Object.values(args).filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
}
