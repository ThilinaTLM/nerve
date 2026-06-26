import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolOutputLimitsPayload } from "@nervekit/shared";
import { appendBoundedTextNotice, boundText } from "@nervekit/tools";

const STORAGE_TEXT_MAX_BYTES = 256 * 1024;
const STORAGE_TEXT_MAX_LINES = 5000;
const STORAGE_TEXT_MAX_LINE_CHARS = 16 * 1024;

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

export async function boundToolResultForStorage(
  result: unknown,
  input: { toolCallId: string; storageHome: string },
): Promise<unknown> {
  const bounded = boundValue(result, []);
  if (!bounded.summary.truncated) return result;

  const rawResultPath = await writeRawResult({
    storageHome: input.storageHome,
    toolCallId: input.toolCallId,
    result,
  });
  return attachRawResultDetails(bounded.value, rawResultPath, bounded.summary);
}

function boundValue(value: unknown, path: string[]): BoundValueResult {
  if (typeof value === "string") {
    if (isImageDataPath(path)) return { value, summary: emptySummary() };
    const bounded = boundText(value, {
      maxBytes: STORAGE_TEXT_MAX_BYTES,
      maxLines: STORAGE_TEXT_MAX_LINES,
      maxLineChars: STORAGE_TEXT_MAX_LINE_CHARS,
    });
    if (!bounded.truncated) return { value, summary: emptySummary() };
    return {
      value: appendBoundedTextNotice(bounded, {
        label: "stored tool result string",
        recoveryHint:
          "Full unbounded result is saved to details.rawResultPath.",
      }),
      summary: {
        ...emptySummary(),
        truncated: true,
        truncatedStrings: 1,
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

function attachRawResultDetails(
  value: unknown,
  rawResultPath: string,
  summary: BoundSummary,
): unknown {
  const storageLimit = {
    truncated: true,
    omittedLines: summary.omittedLines,
    omittedBytes: summary.omittedBytes,
    omittedChars: summary.omittedChars,
    truncatedLines: summary.truncatedLines,
    maxBytes: summary.maxBytes,
    maxLines: summary.maxLines,
    maxLineChars: summary.maxLineChars,
    rawResultPath,
  };
  const details = {
    rawResultPath,
    outputLimits: {
      ...summary,
      rawResultPath,
      truncation: storageLimit,
      storage: storageLimit,
      artifacts: [
        {
          kind: "raw_result" as const,
          path: rawResultPath,
          label: "Raw result",
        },
      ],
    } satisfies ToolOutputLimitsPayload & Record<string, unknown>,
  };

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = { ...(value as Record<string, unknown>) };
    const existingDetails =
      record.details &&
      typeof record.details === "object" &&
      !Array.isArray(record.details)
        ? (record.details as Record<string, unknown>)
        : {};
    record.details = { ...existingDetails, ...details };
    return record;
  }

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: text,
    contentBlocks: [{ type: "text", text }],
    details,
  };
}

async function writeRawResult({
  storageHome,
  toolCallId,
  result,
}: {
  storageHome: string;
  toolCallId: string;
  result: unknown;
}): Promise<string> {
  const dir = join(storageHome, "tmp", "tool-results");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${toolCallId}.json`);
  await writeFile(path, stringifyResult(result), {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

function stringifyResult(result: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    result,
    (_key, value) => {
      if (!value || typeof value !== "object") return value;
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value;
    },
    2,
  );
}

function isImageDataPath(path: string[]): boolean {
  if (path.at(-1) !== "data") return false;
  return path.includes("contentBlocks");
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
