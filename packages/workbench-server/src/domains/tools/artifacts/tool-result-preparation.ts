import {
  type AgentDenialSource,
  boundText,
  projectAgentResult,
  snapshotAgentPreview,
  toolDefinitionByName,
} from "@nervekit/tools";
import type {
  AgentPreviewSnapshot,
  AgentProjectionSnapshot,
  ToolCallErrorDetails,
  ToolCallStatus,
  ToolPhase,
  ToolResultPayloadReference,
  ValidatedToolArtifact,
} from "@nervekit/contracts/tools";
import { ToolResultArtifactValidator } from "./tool-result-artifact-validator.js";
import type { ToolResultPayloadStore } from "./tool-result-payload-store.js";

const STORAGE_TEXT_MAX_BYTES = 256 * 1024;
const STORAGE_TEXT_MAX_LINES = 5000;
const STORAGE_TEXT_MAX_LINE_CHARS = Number.MAX_SAFE_INTEGER;

type BoundSummary = {
  truncated: boolean;
  truncatedStrings: number;
  omittedLines: number;
  omittedBytes: number;
  omittedChars: number;
  truncatedLines: number;
  maxBytes: number;
  maxLines: number;
  maxLineChars: number;
};

type BoundValueResult = { value: unknown; summary: BoundSummary };

export async function prepareToolResult(
  result: unknown,
  input: {
    toolCallId: string;
    conversationId: string;
    payloads: ToolResultPayloadStore;
    toolName?: string;
    args?: unknown;
    status?: ToolCallStatus;
    phase?: ToolPhase;
    error?: string;
    errorDetails?: ToolCallErrorDetails;
    denialSource?: AgentDenialSource;
  },
): Promise<{
  result: unknown;
  resultPayload?: ToolResultPayloadReference;
  validatedArtifacts: ValidatedToolArtifact[];
  agentProjection: AgentProjectionSnapshot;
  agentPreview: AgentPreviewSnapshot;
}> {
  const claims = artifactClaims(result);
  const validator = new ToolResultArtifactValidator(
    input.payloads.home,
    input.payloads,
  );
  const validatedArtifacts = await validator.validateClaims(input, claims);
  const definition = input.toolName
    ? toolDefinitionByName(input.toolName)
    : undefined;
  const context = {
    toolName: input.toolName ?? "unknown",
    args: input.args,
    result,
    status: input.status ?? ("completed" as const),
    phase: input.phase,
    error: input.error,
    errorDetails: input.errorDetails,
    denialSource: input.denialSource,
    validatedArtifacts,
  };
  const firstProjection = projectAgentResult(context, definition?.agentResult);
  const bounded = boundValue(result, []);
  const hasExactArtifact = validatedArtifacts.some(
    (artifact) =>
      artifact.availability === "available" &&
      artifact.access.kind === "agent_file" &&
      (artifact.role === "primary_result" ||
        artifact.role === "overflow_recovery"),
  );
  const hasContinuation =
    (firstProjection.snapshot.continuation?.length ?? 0) > 0;
  const needsPayload =
    bounded.summary.truncated ||
    (!firstProjection.snapshot.fastPath &&
      !hasExactArtifact &&
      !hasContinuation);

  let resultPayload: ToolResultPayloadReference | undefined;
  let completePayload: ValidatedToolArtifact | undefined;
  if (needsPayload) {
    resultPayload = await input.payloads.write(
      input.conversationId,
      input.toolCallId,
      result,
    );
    completePayload = input.payloads.recoveryArtifact(resultPayload);
  }
  const storedResult = bounded.summary.truncated ? bounded.value : result;
  const projection = completePayload
    ? projectAgentResult(
        { ...context, result: storedResult, completePayload },
        definition?.agentResult,
      )
    : firstProjection;

  return {
    result: storedResult,
    ...(resultPayload ? { resultPayload } : {}),
    validatedArtifacts,
    agentProjection: projection.snapshot,
    agentPreview: snapshotAgentPreview(projection.blocks, result),
  };
}

export function prepareTerminalProjection(
  result: unknown,
  input: {
    toolName?: string;
    args?: unknown;
    status: ToolCallStatus;
    phase?: ToolPhase;
    error?: string;
    errorDetails?: ToolCallErrorDetails;
    denialSource?: AgentDenialSource;
  },
): {
  agentProjection: AgentProjectionSnapshot;
  agentPreview: AgentPreviewSnapshot;
} {
  const definition = input.toolName
    ? toolDefinitionByName(input.toolName)
    : undefined;
  const projection = projectAgentResult(
    {
      toolName: input.toolName ?? "unknown",
      args: input.args,
      result,
      status: input.status,
      phase: input.phase,
      error: input.error,
      errorDetails: input.errorDetails,
      denialSource: input.denialSource,
      validatedArtifacts: [],
    },
    definition?.agentResult,
  );
  return {
    agentProjection: projection.snapshot,
    agentPreview: snapshotAgentPreview(projection.blocks, result),
  };
}

function artifactClaims(result: unknown): unknown[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const details = objectRecord((result as Record<string, unknown>).details);
  const limits = objectRecord(details.outputLimits);
  return Array.isArray(limits.artifacts) ? limits.artifacts : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundValue(value: unknown, path: string[]): BoundValueResult {
  if (typeof value === "string") {
    if (isImageDataPath(path)) return { value, summary: emptySummary() };
    const bounded = boundText(value, {
      maxBytes: STORAGE_TEXT_MAX_BYTES,
      maxLines: STORAGE_TEXT_MAX_LINES,
      maxLineChars: STORAGE_TEXT_MAX_LINE_CHARS,
    });
    return {
      value: bounded.text,
      summary: {
        ...emptySummary(),
        truncated: bounded.truncated,
        truncatedStrings: bounded.truncated ? 1 : 0,
        omittedLines: bounded.omittedLines,
        omittedBytes: bounded.omittedBytes,
        omittedChars: bounded.omittedChars,
        truncatedLines: bounded.truncatedLines,
      },
    };
  }
  if (!value || typeof value !== "object")
    return { value, summary: emptySummary() };
  if (Array.isArray(value)) {
    let summary = emptySummary();
    const output = value.map((item, index) => {
      const bounded = boundValue(item, [...path, String(index)]);
      summary = mergeSummary(summary, bounded.summary);
      return bounded.value;
    });
    return { value: output, summary };
  }
  let summary = emptySummary();
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const bounded = boundValue(nested, [...path, key]);
    summary = mergeSummary(summary, bounded.summary);
    output[key] = bounded.value;
  }
  return { value: output, summary };
}

function isImageDataPath(path: string[]): boolean {
  return path.at(-1) === "data" && path.includes("contentBlocks");
}
function emptySummary(): BoundSummary {
  return {
    truncated: false,
    truncatedStrings: 0,
    omittedLines: 0,
    omittedBytes: 0,
    omittedChars: 0,
    truncatedLines: 0,
    maxBytes: STORAGE_TEXT_MAX_BYTES,
    maxLines: STORAGE_TEXT_MAX_LINES,
    maxLineChars: STORAGE_TEXT_MAX_LINE_CHARS,
  };
}
function mergeSummary(left: BoundSummary, right: BoundSummary): BoundSummary {
  return {
    truncated: left.truncated || right.truncated,
    truncatedStrings: left.truncatedStrings + right.truncatedStrings,
    omittedLines: left.omittedLines + right.omittedLines,
    omittedBytes: left.omittedBytes + right.omittedBytes,
    omittedChars: left.omittedChars + right.omittedChars,
    truncatedLines: left.truncatedLines + right.truncatedLines,
    maxBytes: Math.min(left.maxBytes, right.maxBytes),
    maxLines: Math.min(left.maxLines, right.maxLines),
    maxLineChars: Math.min(left.maxLineChars, right.maxLineChars),
  };
}
