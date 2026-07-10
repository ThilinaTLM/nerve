import {
  boundText,
  MODEL_TEXT_MAX_LINE_CHARS,
  MODEL_TEXT_MAX_LINES,
  textLimitSnapshot,
} from "@nervekit/agent-tools";
import type { ToolOutputLimitsPayload } from "@nervekit/contracts";

const MODEL_RESULT_MAX_BYTES = 24_000;

export function annotateToolResultModelLimits(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const model = modelLimitForResult(result);
  if (!model) return result;
  const record = { ...(result as Record<string, unknown>) };
  const details =
    record.details &&
    typeof record.details === "object" &&
    !Array.isArray(record.details)
      ? { ...(record.details as Record<string, unknown>) }
      : {};
  const existingLimits =
    details.outputLimits &&
    typeof details.outputLimits === "object" &&
    !Array.isArray(details.outputLimits)
      ? (details.outputLimits as ToolOutputLimitsPayload)
      : undefined;
  details.outputLimits = {
    ...existingLimits,
    model,
  } satisfies ToolOutputLimitsPayload;
  record.details = details;
  return record;
}

function modelLimitForResult(
  result: object,
): ToolOutputLimitsPayload["model"] | undefined {
  const text = modelTextSource(result);
  if (text === undefined) return undefined;
  const bounded = boundText(text, {
    maxBytes: MODEL_RESULT_MAX_BYTES,
    maxLines: MODEL_TEXT_MAX_LINES,
    maxLineChars: MODEL_TEXT_MAX_LINE_CHARS,
  });
  return {
    ...textLimitSnapshot(bounded),
    contentKind: hasTextContentBlocks(result)
      ? "content_blocks"
      : "formatted_text",
  };
}

function hasTextContentBlocks(result: object): boolean {
  const contentBlocks = (result as Record<string, unknown>).contentBlocks;
  return (
    Array.isArray(contentBlocks) &&
    contentBlocks.some(
      (block) =>
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string",
    )
  );
}

function modelTextSource(result: object): string | undefined {
  const record = result as Record<string, unknown>;
  const contentBlocks = record.contentBlocks;
  if (Array.isArray(contentBlocks)) {
    const texts = contentBlocks.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const blockRecord = block as Record<string, unknown>;
      return blockRecord.type === "text" && typeof blockRecord.text === "string"
        ? [blockRecord.text]
        : [];
    });
    if (texts.length > 0) return texts.join("\n");
  }
  if (typeof record.content === "string") return record.content;
  const parts: string[] = [];
  if (typeof record.stdout === "string" && record.stdout.length > 0) {
    parts.push(`stdout:\n${record.stdout}`);
  }
  if (typeof record.stderr === "string" && record.stderr.length > 0) {
    parts.push(`stderr:\n${record.stderr}`);
  }
  if (Array.isArray(record.entries)) {
    parts.push(record.entries.map((entry) => JSON.stringify(entry)).join("\n"));
  }
  if (Array.isArray(record.matches)) {
    parts.push(record.matches.map((entry) => JSON.stringify(entry)).join("\n"));
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
