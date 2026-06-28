import type {
  GrepMatch,
  TaskLogEvent,
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";

const PREVIEW_COUNT = 10;
const MAX_PREVIEW_CHARS = 8 * 1024;

type Overflow = NonNullable<ToolCallTranscriptRecord["previewOverflow"]>;

type Preview<T> = {
  value: T;
  hidden: number;
  hiddenLines?: number;
  hiddenChars?: number;
};

type UnknownPreview = {
  value: unknown;
  hiddenLines: number;
  hiddenChars: number;
  hiddenItems: number;
};

function firstLines(
  text: string | undefined,
  count = PREVIEW_COUNT,
): Preview<string | undefined> {
  if (text === undefined) return emptyTextPreview(undefined);
  const lineEnd = endAfterFirstLines(text, count);
  const charEnd = Math.min(lineEnd, MAX_PREVIEW_CHARS);
  const value = text.slice(0, charEnd);
  const hiddenLines = countLinesFrom(text, lineEnd);
  const hiddenChars = Math.max(0, text.length - charEnd);
  return {
    value,
    hidden: visibleHiddenCount(hiddenLines, hiddenChars),
    hiddenLines,
    hiddenChars,
  };
}

function lastLines(
  text: string | undefined,
  count = PREVIEW_COUNT,
): Preview<string | undefined> {
  if (text === undefined) return emptyTextPreview(undefined);
  const lineStart = startBeforeLastLines(text, count);
  const charStart = Math.max(lineStart, text.length - MAX_PREVIEW_CHARS);
  const value = text.slice(charStart);
  const hiddenLines = countLinesUntil(text, lineStart);
  const hiddenChars = Math.max(0, charStart);
  return {
    value,
    hidden: visibleHiddenCount(hiddenLines, hiddenChars),
    hiddenLines,
    hiddenChars,
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

function emptyTextPreview<T extends string | undefined>(value: T): Preview<T> {
  return { value, hidden: 0, hiddenLines: 0, hiddenChars: 0 };
}

function visibleHiddenCount(hiddenLines: number, hiddenChars: number): number {
  return hiddenLines > 0 ? hiddenLines : hiddenChars;
}

function endAfterFirstLines(text: string, count: number): number {
  if (count <= 0) return 0;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    if (lines >= count) return index;
    lines += 1;
  }
  return text.length;
}

function startBeforeLastLines(text: string, count: number): number {
  if (count <= 0) return text.length;
  let lines = 1;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== "\n") continue;
    lines += 1;
    if (lines > count) return index + 1;
  }
  return 0;
}

function countLinesFrom(text: string, offset: number): number {
  if (offset >= text.length) return 0;
  let start = offset;
  if (text[start] === "\n") start += 1;
  if (start >= text.length) return 0;
  let lines = 1;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\n") lines += 1;
  }
  return lines;
}

function countLinesUntil(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const end = Math.min(offset - 1, text.length);
  if (end <= 0) return 0;
  let lines = 1;
  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") lines += 1;
  }
  return lines;
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
  if (text === undefined)
    return sanitizePreviewValue(result) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...result, content: text };
  delete next.stdout;
  delete next.stderr;
  const blocks = arrayField<Record<string, unknown>>(next.contentBlocks);
  if (blocks) {
    next.contentBlocks = blocks.map((block) =>
      block.type === "text" ? { ...block, text } : sanitizePreviewValue(block),
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
  hiddenLines: number;
  hiddenChars: number;
} {
  const blocks = arrayField<Record<string, unknown>>(result.contentBlocks);
  if (!blocks) {
    return {
      result: sanitizePreviewValue(result) as Record<string, unknown>,
      hidden: 0,
      hiddenLines: 0,
      hiddenChars: 0,
    };
  }
  let hiddenLines = 0;
  let hiddenChars = 0;
  const nextBlocks = blocks.map((block) => {
    if (block.type === "image") return imagePlaceholder(block);
    if (block.type !== "text" || typeof block.text !== "string") {
      return sanitizePreviewValue(block);
    }
    const preview = firstLines(block.text);
    hiddenLines += preview.hiddenLines ?? 0;
    hiddenChars += preview.hiddenChars ?? 0;
    return { ...block, text: preview.value ?? "" };
  });
  return {
    result: {
      ...(sanitizePreviewValue(result) as Record<string, unknown>),
      contentBlocks: nextBlocks,
    },
    hidden: visibleHiddenCount(hiddenLines, hiddenChars),
    hiddenLines,
    hiddenChars,
  };
}

function sanitizePreviewValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePreviewValue(item));
  }
  const recordValue = value as Record<string, unknown>;
  if (recordValue.type === "image") return imagePlaceholder(recordValue);
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(recordValue)) {
    next[key] = sanitizePreviewValue(nested);
  }
  return next;
}

function assignPathArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...args };
  return next;
}

function previewUnknown(value: unknown): UnknownPreview {
  if (typeof value === "string") {
    const preview = firstLines(value);
    return {
      value: preview.value,
      hiddenLines: preview.hiddenLines ?? 0,
      hiddenChars: preview.hiddenChars ?? 0,
      hiddenItems: 0,
    };
  }
  if (Array.isArray(value)) {
    const items = firstItems(value);
    let hiddenLines = 0;
    let hiddenChars = 0;
    const previewItems = items.value?.map((item) => {
      const preview = previewUnknown(item);
      hiddenLines += preview.hiddenLines;
      hiddenChars += preview.hiddenChars;
      return preview.value;
    });
    return {
      value: previewItems,
      hiddenLines,
      hiddenChars,
      hiddenItems: items.hidden,
    };
  }
  if (!value || typeof value !== "object") {
    return { value, hiddenLines: 0, hiddenChars: 0, hiddenItems: 0 };
  }
  const recordValue = value as Record<string, unknown>;
  if (recordValue.type === "image") {
    return {
      value: imagePlaceholder(recordValue),
      hiddenLines: 0,
      hiddenChars: 0,
      hiddenItems: 0,
    };
  }
  let hiddenLines = 0;
  let hiddenChars = 0;
  let hiddenItems = 0;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(recordValue)) {
    const preview = previewUnknown(nested);
    next[key] = preview.value;
    hiddenLines += preview.hiddenLines;
    hiddenChars += preview.hiddenChars;
    hiddenItems += preview.hiddenItems;
  }
  return { value: next, hiddenLines, hiddenChars, hiddenItems };
}

function overflow(
  hidden: number,
  noun: string,
  direction: Overflow["direction"],
): Overflow | undefined {
  return hidden > 0 ? { hidden, noun, direction } : undefined;
}

function textOverflowStats(previews: Array<Preview<unknown>>): {
  hidden: number;
  noun: string;
} {
  const hiddenLines = previews.reduce(
    (total, preview) => total + (preview.hiddenLines ?? 0),
    0,
  );
  const hiddenChars = previews.reduce(
    (total, preview) => total + (preview.hiddenChars ?? 0),
    0,
  );
  if (hiddenLines > 0) return { hidden: hiddenLines, noun: "lines" };
  return { hidden: hiddenChars, noun: "characters" };
}

function unknownOverflowStats(previews: UnknownPreview[]): {
  hidden: number;
  noun: string;
} {
  const hiddenItems = previews.reduce(
    (total, preview) => total + preview.hiddenItems,
    0,
  );
  if (hiddenItems > 0) return { hidden: hiddenItems, noun: "items" };
  const hiddenLines = previews.reduce(
    (total, preview) => total + preview.hiddenLines,
    0,
  );
  if (hiddenLines > 0) return { hidden: hiddenLines, noun: "lines" };
  const hiddenChars = previews.reduce(
    (total, preview) => total + preview.hiddenChars,
    0,
  );
  return { hidden: hiddenChars, noun: "characters" };
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
          resultPreview = withTextContent(resultRecord, preview.value);
          ({ hidden, noun } = textOverflowStats([preview]));
        } else {
          const blocks = previewContentBlocks(resultRecord);
          resultPreview = blocks.result;
          hidden = blocks.hidden;
          noun = blocks.hiddenLines > 0 ? "lines" : "characters";
        }
      }
      direction = "head";
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
      ({ hidden, noun } = textOverflowStats([command, output]));
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
      ({ hidden, noun } = textOverflowStats([code, output]));
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
      ({ hidden, noun } = textOverflowStats([content]));
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
      ({ hidden, noun } = textOverflowStats([diff]));
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
      ({ hidden, noun } = textOverflowStats([content]));
      direction = "head";
      break;
    }

    case "todos_set":
    case "todos_get": {
      // Todo lists are short, presentational checklists. Keep the full list in
      // both previews so the timeline card and the composer todo chip can
      // reflect every item and an accurate completed/total count.
      break;
    }

    default: {
      const argsBound = previewUnknown(args);
      const resultBound = previewUnknown(result);
      argsPreview = argsBound.value;
      resultPreview = resultBound.value;
      ({ hidden, noun } = unknownOverflowStats([argsBound, resultBound]));
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
