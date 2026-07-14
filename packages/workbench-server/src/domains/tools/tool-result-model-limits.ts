import {
  boundContentBlocks,
  boundText,
  MODEL_TOOL_RESULT_MAX_BYTES,
  MODEL_TEXT_MAX_LINE_CHARS,
  MODEL_TEXT_MAX_LINES,
  textLimitSnapshot,
  type ContentBlockLike,
} from "@nervekit/host-runtime/tools";
import type { ToolOutputLimitsPayload } from "@nervekit/contracts";

const MAX_RECOVERY_HINT_CHARS = 2_048;

export function annotateToolResultModelLimits(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const model = modelLimitForResult(result);
  if (!model) return result;
  const record = { ...(result as Record<string, unknown>) };
  const details = objectRecord(record.details);
  const existingLimits = objectRecord(
    details.outputLimits,
  ) as ToolOutputLimitsPayload;
  details.outputLimits = {
    ...existingLimits,
    model,
  } satisfies ToolOutputLimitsPayload;
  record.details = details;
  return record;
}

export function modelLimitForResult(
  result: unknown,
): ToolOutputLimitsPayload["model"] | undefined {
  const projection = modelProjection(result);
  if (!projection) return undefined;
  const bounded = boundText(projection.sourceText, {
    maxBytes: MODEL_TOOL_RESULT_MAX_BYTES,
    maxLines: MODEL_TEXT_MAX_LINES,
    maxLineChars: MODEL_TEXT_MAX_LINE_CHARS,
  });
  const displayedBytes = Buffer.byteLength(projection.displayedText, "utf8");
  return {
    ...textLimitSnapshot(bounded),
    displayedBytes,
    displayedChars: projection.displayedText.length,
    displayedLines: countLines(projection.displayedText),
    contentKind: projection.contentKind,
  };
}

export function resultTruncatesForModel(result: unknown): boolean {
  return modelLimitForResult(result)?.truncated === true;
}

export function recoveryHintForResult(result: unknown): string | undefined {
  const limits = outputLimitsFromResult(result);
  const continuation = limits?.continuation;
  const hints: string[] = [];
  if (typeof continuation?.nextOffset === "number") {
    hints.push(`Continue with offset ${continuation.nextOffset}.`);
  }
  if (typeof continuation?.nextByteOffset === "number") {
    hints.push(`Continue with byteOffset ${continuation.nextByteOffset}.`);
  }
  if (typeof continuation?.hint === "string" && continuation.hint.trim()) {
    hints.push(continuation.hint.trim());
  }
  for (const artifact of limits?.artifacts ?? []) {
    if (!artifact?.path) continue;
    hints.push(`${artifact.label ?? "Full output"}: ${artifact.path}.`);
  }
  if (hints.length === 0) return undefined;
  const joined = hints.join(" ");
  return joined.length <= MAX_RECOVERY_HINT_CHARS
    ? joined
    : `${joined.slice(0, MAX_RECOVERY_HINT_CHARS - 1)}…`;
}

export function hasRecoveryRoute(result: unknown): boolean {
  const limits = outputLimitsFromResult(result);
  return Boolean(
    (limits?.continuation &&
      (typeof limits.continuation.nextOffset === "number" ||
        typeof limits.continuation.nextByteOffset === "number" ||
        Boolean(limits.continuation.hint))) ||
    limits?.artifacts?.some((artifact) => Boolean(artifact.path)),
  );
}

export function boundModelText(text: string, result?: unknown): string {
  const [block] = boundModelContentBlocks(
    [{ type: "text" as const, text }],
    result,
  );
  return block?.type === "text" ? block.text : "";
}

export function boundModelContentBlocks<T extends ContentBlockLike>(
  blocks: readonly T[],
  result?: unknown,
): T[] {
  return boundContentBlocks(
    blocks,
    {
      maxBytes: MODEL_TOOL_RESULT_MAX_BYTES,
      maxLines: MODEL_TEXT_MAX_LINES,
      maxLineChars: MODEL_TEXT_MAX_LINE_CHARS,
    },
    { recoveryHint: recoveryHintForResult(result) },
  ).contentBlocks;
}

type ModelProjection = {
  sourceText: string;
  displayedText: string;
  contentKind: "content_blocks" | "formatted_text";
};

function modelProjection(result: unknown): ModelProjection | undefined {
  if (typeof result === "string") {
    return {
      sourceText: result,
      displayedText: boundModelText(result, result),
      contentKind: "formatted_text",
    };
  }
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const blocks = contentBlocks(record);
  if (blocks) {
    const bounded = boundModelContentBlocks(blocks, result);
    return {
      sourceText: textFromBlocks(blocks),
      displayedText: textFromBlocks(bounded),
      contentKind: "content_blocks",
    };
  }
  const sourceText = formattedTextSource(record);
  if (sourceText === undefined) return undefined;
  return {
    sourceText,
    displayedText: boundModelText(sourceText, result),
    contentKind: "formatted_text",
  };
}

function contentBlocks(
  record: Record<string, unknown>,
): ContentBlockLike[] | undefined {
  if (
    !Array.isArray(record.contentBlocks) ||
    record.contentBlocks.length === 0
  ) {
    return undefined;
  }
  const blocks: ContentBlockLike[] = [];
  for (const block of record.contentBlocks) {
    if (!block || typeof block !== "object") return undefined;
    const item = block as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") {
      blocks.push({ type: "text", text: item.text });
    } else if (
      item.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string"
    ) {
      blocks.push({ type: "image", data: item.data, mimeType: item.mimeType });
    } else {
      return undefined;
    }
  }
  return blocks.some((block) => block.type === "text") ? blocks : undefined;
}

function formattedTextSource(
  record: Record<string, unknown>,
): string | undefined {
  const parts: string[] = [];
  if (typeof record.content === "string") parts.push(record.content);
  if (typeof record.stdout === "string" && record.stdout.length > 0) {
    parts.push(`stdout:\n${record.stdout}`);
  }
  if (typeof record.stderr === "string" && record.stderr.length > 0) {
    parts.push(`stderr:\n${record.stderr}`);
  }
  if (typeof record.exitCode === "number") {
    parts.push(`exitCode: ${record.exitCode}`);
  }
  if (Array.isArray(record.entries)) {
    parts.push(
      `entries:\n${record.entries.map((entry) => JSON.stringify(entry)).join("\n")}`,
    );
  }
  if (Array.isArray(record.matches)) {
    parts.push(
      `matches:\n${record.matches.map((entry) => JSON.stringify(entry)).join("\n")}`,
    );
  }
  if (parts.length > 0) return parts.join("\n\n");
  return JSON.stringify(record, null, 2);
}

function outputLimitsFromResult(
  result: unknown,
): ToolOutputLimitsPayload | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const details = objectRecord((result as Record<string, unknown>).details);
  return details.outputLimits && typeof details.outputLimits === "object"
    ? (details.outputLimits as ToolOutputLimitsPayload)
    : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function textFromBlocks(blocks: readonly ContentBlockLike[]): string {
  return blocks
    .filter(
      (block): block is Extract<ContentBlockLike, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}
