import type {
  GrepMatch,
  TaskLogEvent,
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";

const PREVIEW_COUNT = 10;

type Overflow = NonNullable<ToolCallTranscriptRecord["previewOverflow"]>;

type Preview<T> = { value: T; hidden: number };

function firstLines(
  text: string | undefined,
  count = PREVIEW_COUNT,
): Preview<string | undefined> {
  if (text === undefined) return { value: undefined, hidden: 0 };
  const lines = text.split("\n");
  return {
    value: lines.length > count ? lines.slice(0, count).join("\n") : text,
    hidden: Math.max(0, lines.length - count),
  };
}

function lastLines(
  text: string | undefined,
  count = PREVIEW_COUNT,
): Preview<string | undefined> {
  if (text === undefined) return { value: undefined, hidden: 0 };
  const lines = text.split("\n");
  return {
    value:
      lines.length > count
        ? lines.slice(lines.length - count).join("\n")
        : text,
    hidden: Math.max(0, lines.length - count),
  };
}

function firstItems<T>(
  items: T[] | undefined,
  count = PREVIEW_COUNT,
): Preview<T[] | undefined> {
  if (!items) return { value: items, hidden: 0 };
  return {
    value: items.length > count ? items.slice(0, count) : items,
    hidden: Math.max(0, items.length - count),
  };
}

function lastItems<T>(
  items: T[] | undefined,
  count = PREVIEW_COUNT,
): Preview<T[] | undefined> {
  if (!items) return { value: items, hidden: 0 };
  return {
    value: items.length > count ? items.slice(items.length - count) : items,
    hidden: Math.max(0, items.length - count),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayField<T = unknown>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function outputText(result: Record<string, unknown>): string | undefined {
  const content = stringField(result.content);
  if (content !== undefined) return content;
  const blocks = arrayField<Record<string, unknown>>(result.contentBlocks);
  const textBlocks = blocks
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text));
  if (textBlocks && textBlocks.length > 0) return textBlocks.join("\n");
  const stdout = stringField(result.stdout);
  const stderr = stringField(result.stderr);
  if (stdout === undefined && stderr === undefined) return undefined;
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}\n${stderr}`;
}

function withTextContent(
  result: Record<string, unknown>,
  text: string | undefined,
): Record<string, unknown> {
  if (text === undefined) return result;
  const next: Record<string, unknown> = { ...result, content: text };
  delete next.stdout;
  delete next.stderr;
  const blocks = arrayField<Record<string, unknown>>(next.contentBlocks);
  if (blocks) {
    next.contentBlocks = blocks.map((block) =>
      block.type === "text" ? { ...block, text } : imagePlaceholder(block),
    );
  }
  return next;
}

function imagePlaceholder(
  block: Record<string, unknown>,
): Record<string, unknown> {
  if (block.type !== "image") return block;
  return {
    type: "text",
    text: `[Image omitted from transcript preview; open details to view ${String(block.mimeType ?? "image")}.]`,
  };
}

function previewContentBlocks(result: Record<string, unknown>): {
  result: Record<string, unknown>;
  hidden: number;
} {
  const blocks = arrayField<Record<string, unknown>>(result.contentBlocks);
  if (!blocks) return { result, hidden: 0 };
  let hidden = 0;
  const nextBlocks = blocks.map((block) => {
    if (block.type === "image") return imagePlaceholder(block);
    if (block.type !== "text" || typeof block.text !== "string") return block;
    const preview = firstLines(block.text);
    hidden += preview.hidden;
    return { ...block, text: preview.value ?? "" };
  });
  return { result: { ...result, contentBlocks: nextBlocks }, hidden };
}

function assignPathArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...args };
  return next;
}

function previewUnknown(value: unknown): {
  value: unknown;
  hiddenLines: number;
} {
  if (typeof value === "string") {
    const preview = firstLines(value);
    return { value: preview.value, hiddenLines: preview.hidden };
  }
  if (Array.isArray(value)) {
    const preview = firstItems(value);
    return { value: preview.value, hiddenLines: preview.hidden };
  }
  if (!value || typeof value !== "object") return { value, hiddenLines: 0 };
  let hiddenLines = 0;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string") {
      const preview = firstLines(nested);
      next[key] = preview.value;
      hiddenLines += preview.hidden;
    } else if (Array.isArray(nested)) {
      const preview = firstItems(nested);
      next[key] = preview.value;
      hiddenLines += preview.hidden;
    } else {
      next[key] = nested;
    }
  }
  return { value: next, hiddenLines };
}

function overflow(
  hidden: number,
  noun: string,
  direction: Overflow["direction"],
): Overflow | undefined {
  return hidden > 0 ? { hidden, noun, direction } : undefined;
}

function sortEntries(
  entries: Array<{ kind?: string; path?: string }>,
): typeof entries {
  return [...entries].sort((a, b) => {
    if (a.kind === b.kind)
      return String(a.path ?? "").localeCompare(String(b.path ?? ""));
    return a.kind === "directory" ? -1 : 1;
  });
}

export function toToolCallTranscriptRecord(
  toolCall: ToolCallRecord,
): ToolCallTranscriptRecord {
  const { args, result, ...base } = toolCall;
  const argsRecord = record(args);
  const resultRecord = record(result);
  let argsPreview: unknown = args;
  let resultPreview: unknown = result;
  let hidden = 0;
  let noun = "lines";
  let direction: Overflow["direction"] = "head";

  switch (toolCall.toolName) {
    case "read": {
      argsPreview = assignPathArgs(argsRecord);
      if (result && typeof result === "object") {
        const text = stringField(resultRecord.content);
        if (text !== undefined) {
          const preview = firstLines(text);
          resultPreview = { ...resultRecord, content: preview.value };
          hidden = preview.hidden;
        } else {
          const blocks = previewContentBlocks(resultRecord);
          resultPreview = blocks.result;
          hidden = blocks.hidden;
        }
      }
      direction = "head";
      noun = "lines";
      break;
    }

    case "find": {
      const entries = firstItems(arrayField(resultRecord.entries));
      resultPreview = { ...resultRecord, entries: entries.value };
      hidden = entries.hidden;
      noun = "files";
      direction = "head";
      break;
    }

    case "grep": {
      const matches = firstItems(arrayField<GrepMatch>(resultRecord.matches));
      resultPreview = { ...resultRecord, matches: matches.value };
      hidden = matches.hidden;
      noun = "matches";
      direction = "head";
      break;
    }

    case "ls": {
      const sorted = sortEntries(arrayField(resultRecord.entries) ?? []);
      const entries = firstItems(sorted);
      resultPreview = { ...resultRecord, entries: entries.value };
      hidden = entries.hidden;
      noun = "entries";
      direction = "head";
      break;
    }

    case "bash": {
      const command = firstLines(stringField(argsRecord.command));
      argsPreview = { ...argsRecord, command: command.value };
      const output = lastLines(outputText(resultRecord));
      resultPreview = withTextContent(resultRecord, output.value);
      hidden = command.hidden + output.hidden;
      noun = "lines";
      direction =
        command.hidden > 0 && output.hidden > 0
          ? "mixed"
          : output.hidden > 0
            ? "tail"
            : "head";
      break;
    }

    case "python": {
      const code = firstLines(stringField(argsRecord.code));
      argsPreview =
        code.value === undefined
          ? argsRecord
          : { ...argsRecord, code: code.value };
      const output = lastLines(outputText(resultRecord));
      resultPreview = withTextContent(resultRecord, output.value);
      hidden = code.hidden + output.hidden;
      noun = "lines";
      direction =
        code.hidden > 0 && output.hidden > 0
          ? "mixed"
          : output.hidden > 0
            ? "tail"
            : "head";
      break;
    }

    case "write": {
      const content = lastLines(stringField(argsRecord.content));
      argsPreview =
        content.value === undefined
          ? argsRecord
          : { ...argsRecord, content: content.value };
      hidden = content.hidden;
      noun = "lines";
      direction = "tail";
      break;
    }

    case "edit": {
      const diff = lastLines(stringField(record(resultRecord.details).diff));
      resultPreview = {
        ...resultRecord,
        details:
          diff.value === undefined
            ? resultRecord.details
            : { ...record(resultRecord.details), diff: diff.value },
      };
      hidden = diff.hidden;
      noun = "lines";
      direction = "tail";
      break;
    }

    case "task_logs": {
      const events = lastItems(arrayField<TaskLogEvent>(resultRecord.events));
      resultPreview = { ...resultRecord, events: events.value };
      hidden = events.hidden;
      noun = "events";
      direction = "tail";
      break;
    }

    case "plan_mode_present": {
      const review = record(resultRecord.review);
      const content = firstLines(stringField(review.content));
      resultPreview = {
        ...resultRecord,
        review:
          content.value === undefined
            ? resultRecord.review
            : { ...review, content: content.value },
      };
      hidden = content.hidden;
      noun = "lines";
      direction = "head";
      break;
    }

    default: {
      const argsBound = previewUnknown(args);
      const resultBound = previewUnknown(result);
      argsPreview = argsBound.value;
      resultPreview = resultBound.value;
      hidden = argsBound.hiddenLines + resultBound.hiddenLines;
      noun = "items";
      direction = "head";
    }
  }

  return {
    ...base,
    argsPreview,
    resultPreview,
    previewOverflow: overflow(hidden, noun, direction),
  };
}
