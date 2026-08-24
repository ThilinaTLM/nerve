import { boundText } from "@nervekit/tools";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { ToolResultPayloadReference } from "@nervekit/contracts";
import { resultTruncatesForModel } from "./tool-result-model-limits.js";
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

type BoundValueResult = {
  value: unknown;
  summary: BoundSummary;
};

export async function prepareToolResult(
  result: unknown,
  input: {
    toolCallId: string;
    conversationId: string;
    payloads: ToolResultPayloadStore;
  },
): Promise<{
  result: unknown;
  resultPayload?: ToolResultPayloadReference;
}> {
  const completeResult = await recoverCompleteResult(
    result,
    input.payloads.home,
  );
  if (!resultTruncatesForModel(completeResult)) {
    return { result: completeResult };
  }

  // Preserve the complete value before applying any storage/model projection.
  const resultPayload = await input.payloads.write(
    input.conversationId,
    input.toolCallId,
    completeResult,
  );
  const bounded = boundValue(completeResult, []);
  return {
    result: bounded.value,
    resultPayload,
  };
}

async function recoverCompleteResult(
  result: unknown,
  home: string,
): Promise<unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const record = result as Record<string, unknown>;
  const details = objectRecord(record.details);
  const outputLimits = objectRecord(details.outputLimits);
  const artifacts = Array.isArray(outputLimits.artifacts)
    ? outputLimits.artifacts
    : [];
  const rawPath =
    typeof details.rawResultPath === "string"
      ? details.rawResultPath
      : undefined;
  const fullOutputPath =
    typeof details.fullOutputPath === "string"
      ? details.fullOutputPath
      : artifacts
          .map(objectRecord)
          .find((artifact) => artifact.kind === "full_output")?.path;
  const sourcePath =
    rawPath ??
    (typeof fullOutputPath === "string" ? fullOutputPath : undefined);
  if (!sourcePath) return result;
  if (!isSafeLegacySourcePath(home, sourcePath)) {
    return sanitizeRecoveredResult(result);
  }
  try {
    const raw = await readFile(sourcePath, "utf8");
    if (isDisposableLegacySourcePath(home, sourcePath)) {
      await rm(sourcePath, { force: true }).catch(() => undefined);
    }
    if (rawPath) return sanitizeRecoveredResult(JSON.parse(raw) as unknown);
    return sanitizeRecoveredResult({
      ...record,
      content: raw,
      contentBlocks: [{ type: "text", text: raw }],
    });
  } catch {
    return sanitizeRecoveredResult(result);
  }
}

function sanitizeRecoveredResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRecoveredResult);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === "rawResultPath" ||
      key === "fullOutputPath" ||
      key === "continuation"
    ) {
      continue;
    }
    if (key === "artifacts" && Array.isArray(nested)) {
      const safe = nested.filter((artifact) => {
        const path = objectRecord(artifact).path;
        return typeof path !== "string" || !isAbsolute(path);
      });
      if (safe.length > 0) output[key] = safe;
      continue;
    }
    output[key] = sanitizeRecoveredResult(nested);
  }
  return output;
}

function isSafeLegacySourcePath(home: string, path: string): boolean {
  if (!isAbsolute(path)) return false;
  const root = resolve(home);
  const candidate = resolve(path);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function isDisposableLegacySourcePath(home: string, path: string): boolean {
  const candidate = resolve(path);
  return ["tool-outputs", "tool-results"].some((directory) => {
    const root = resolve(home, "tmp", directory);
    return candidate === root || candidate.startsWith(`${root}${sep}`);
  });
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

  if (!value || typeof value !== "object") {
    return { value, summary: emptySummary() };
  }

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
