import type { ToolUserProjection } from "@nervekit/contracts/core";
import {
  buildWebFetchTranscriptPreview,
  buildWebSearchTranscriptPreview,
} from "./web-tool-transcript-preview.js";
import {
  firstLines,
  lastLines,
  MAX_PREVIEW_CHARS,
  PREVIEW_COUNT,
  textOverflowStats,
  visibleHiddenCount,
  type Preview,
} from "./transcript-text-preview.js";

type Overflow = NonNullable<ToolUserProjection["previewOverflow"]>;

type UnknownPreview = {
  value: unknown;
  hiddenLines: number;
  hiddenChars: number;
  hiddenItems: number;
};

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

function nonnegativeIntegerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function editDetailsPreview(
  value: unknown,
  diff: string | undefined,
): Record<string, unknown> {
  const details = record(value);
  const operationCount = nonnegativeIntegerField(details.operationCount);
  const dryRun =
    typeof details.dryRun === "boolean" ? details.dryRun : undefined;
  return {
    ...(diff === undefined ? {} : { diff }),
    ...(operationCount === undefined ? {} : { operationCount }),
    ...(dryRun === undefined ? {} : { dryRun }),
  };
}

function editDiff(value: unknown): string | undefined {
  return stringField(record(record(value).details).diff);
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
    const imageBlocks = blocks
      .filter((block) => block.type === "image")
      .map((block) => imagePlaceholder(block));
    if (imageBlocks.length > 0) next.contentBlocks = imageBlocks;
    else delete next.contentBlocks;
  }
  return next;
}

function imagePlaceholder(
  block: Record<string, unknown>,
): Record<string, unknown> {
  if (block.type !== "image") return block;
  return {
    type: "image",
    assetId: block.assetId,
    mimeType: block.mimeType,
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

function sanitizePreviewValue(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") return value;
  if (depth >= MAX_PUBLIC_PREVIEW_DEPTH) {
    return "[Nested preview omitted; open details.]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, PREVIEW_COUNT)
      .map((item) => sanitizePreviewValue(item, depth + 1));
  }
  const recordValue = value as Record<string, unknown>;
  if (recordValue.type === "image") return imagePlaceholder(recordValue);
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(recordValue).slice(
    0,
    PREVIEW_COUNT,
  )) {
    next[key] = sanitizePreviewValue(nested, depth + 1);
  }
  return next;
}

function assignPathArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...args };
  return next;
}

function previewUnknown(value: unknown, depth = 0): UnknownPreview {
  if (depth >= MAX_PUBLIC_PREVIEW_DEPTH) {
    return {
      value: "[Nested preview omitted; open details.]",
      hiddenLines: 0,
      hiddenChars: 0,
      hiddenItems: 1,
    };
  }
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
      const preview = previewUnknown(item, depth + 1);
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
  for (const [key, nested] of Object.entries(recordValue).slice(
    0,
    PREVIEW_COUNT,
  )) {
    const preview = previewUnknown(nested, depth + 1);
    next[key] = preview.value;
    hiddenLines += preview.hiddenLines;
    hiddenChars += preview.hiddenChars;
    hiddenItems += preview.hiddenItems;
  }
  hiddenItems += Math.max(0, Object.keys(recordValue).length - PREVIEW_COUNT);
  return { value: next, hiddenLines, hiddenChars, hiddenItems };
}

function overflow(
  hidden: number,
  noun: string,
  direction: Overflow["direction"],
): Overflow | undefined {
  return hidden > 0 ? { hidden, noun, direction } : undefined;
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

function exploreReportPreview(
  report: Record<string, unknown>,
): Record<string, unknown> {
  const summary = { ...report };
  delete summary.report;
  delete summary.steps;
  return summary;
}

const SECRET_LIKE_KEY =
  /(?:^|[_-])(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)(?:$|[_-])/i;
const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;
const MAX_PUBLIC_PREVIEW_DEPTH = 6;
const MAX_PUBLIC_PREVIEW_ENTRIES = 128;

type PublicPreviewState = {
  textBytes: number;
  entries: number;
  hiddenChars: number;
  hiddenItems: number;
};

function finalizePublicPreview(
  argsPreview: unknown,
  resultPreview: unknown,
  resultFirst = false,
): {
  argsPreview: unknown;
  resultPreview: unknown;
  hiddenChars: number;
  hiddenItems: number;
  state: PublicPreviewState;
} {
  const state: PublicPreviewState = {
    textBytes: 0,
    entries: 0,
    hiddenChars: 0,
    hiddenItems: 0,
  };
  const projectedResult = resultFirst
    ? projectPublicValue(resultPreview, state, 0)
    : undefined;
  const projectedArgs = projectPublicValue(argsPreview, state, 0);
  return {
    argsPreview: projectedArgs,
    resultPreview: resultFirst
      ? projectedResult
      : projectPublicValue(resultPreview, state, 0),
    hiddenChars: state.hiddenChars,
    hiddenItems: state.hiddenItems,
    state,
  };
}

function projectPublicValue(
  value: unknown,
  state: PublicPreviewState,
  depth: number,
): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (CREDENTIAL_URL.test(value)) {
      state.hiddenChars += value.length;
      return "[Credential-bearing URL omitted; open details.]";
    }
    const remaining = Math.max(0, MAX_PREVIEW_CHARS - state.textBytes);
    const projected = truncateUtf8(value, remaining);
    state.textBytes += Buffer.byteLength(projected, "utf8");
    state.hiddenChars += value.length - projected.length;
    return projected;
  }
  if (typeof value !== "object") {
    return projectPublicValue(String(value), state, depth);
  }
  if (depth >= MAX_PUBLIC_PREVIEW_DEPTH) {
    state.hiddenItems += 1;
    return "[Nested preview omitted; open details.]";
  }
  if (Array.isArray(value)) {
    const available = Math.max(0, MAX_PUBLIC_PREVIEW_ENTRIES - state.entries);
    const selected = value.slice(0, Math.min(PREVIEW_COUNT, available));
    state.entries += selected.length;
    state.hiddenItems += value.length - selected.length;
    return selected.map(
      (item) => projectPublicValue(item, state, depth + 1) ?? null,
    );
  }
  const recordValue = value as Record<string, unknown>;
  if (recordValue.type === "image") return imagePlaceholder(recordValue);
  const output: Record<string, unknown> = {};
  const entries = Object.entries(recordValue);
  for (const [key, nested] of entries) {
    if (
      state.entries >= MAX_PUBLIC_PREVIEW_ENTRIES ||
      Object.keys(output).length >= PREVIEW_COUNT
    ) {
      state.hiddenItems += 1;
      continue;
    }
    if (SECRET_LIKE_KEY.test(key) || key.length > 128) {
      state.hiddenItems += 1;
      continue;
    }
    const projected = projectPublicValue(nested, state, depth + 1);
    if (projected === undefined) continue;
    state.entries += 1;
    output[key] = projected;
  }
  return output;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1] ?? "")) low -= 1;
  return value.slice(0, low);
}

function withoutProducerArtifactClaims(value: unknown): unknown {
  const result = record(value);
  const details = record(result.details);
  const outputLimits = record(details.outputLimits);
  const declaredArtifacts = Array.isArray(outputLimits.artifacts)
    ? outputLimits.artifacts
    : undefined;
  const artifacts = declaredArtifacts?.filter(
    (artifact) => "kind" in record(artifact),
  );
  if (!artifacts || artifacts.length === declaredArtifacts?.length)
    return value;
  const nextOutputLimits = { ...outputLimits };
  if (artifacts.length > 0) nextOutputLimits.artifacts = artifacts;
  else delete nextOutputLimits.artifacts;
  const nextDetails = { ...details };
  if (Object.keys(nextOutputLimits).length > 0) {
    nextDetails.outputLimits = nextOutputLimits;
  } else {
    delete nextDetails.outputLimits;
  }
  const nextResult = { ...result };
  if (Object.keys(nextDetails).length > 0) nextResult.details = nextDetails;
  else delete nextResult.details;
  return nextResult;
}

/** Build a bounded, secret-safe public preview of provider arguments. */
export function toPublicToolCallArgsPreview(
  args: Record<string, unknown>,
): Record<string, unknown> {
  return record(finalizePublicPreview(args, undefined).argsPreview);
}

export function buildUserProjection(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): ToolUserProjection {
  let publicResult = withoutProducerArtifactClaims(result);
  // Core delegation, ask_user and async bash return JSON text rather than the old details records.
  if (
    toolName === "ask_user" ||
    toolName === "explore" ||
    toolName.startsWith("task_") ||
    toolName.startsWith("subagent_")
  ) {
    const text = stringField(record(publicResult).content);
    if (text) {
      try {
        const value: unknown = JSON.parse(text);
        publicResult = toolName === "explore" ? { reports: value } : value;
      } catch {
        /* A failed call may return plain text. */
      }
    }
  }
  const argsRecord = record(args);
  const resultRecord = record(publicResult);
  let argsPreview: unknown = args;
  let resultPreview: unknown = publicResult;
  let hidden = 0;
  let noun = "lines";
  let direction: Overflow["direction"];
  let semanticOverflow = false;
  switch (toolName) {
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
      resultPreview = {
        path: resultRecord.path,
        entries: entries.value,
        details: resultRecord.details,
      };
      hidden = entries.hidden;
      noun = "files";
      direction = "head";
      break;
    }

    case "grep": {
      const matches = firstItems(
        arrayField<Record<string, unknown>>(resultRecord.matches),
      );
      resultPreview = {
        path: resultRecord.path,
        matches: matches.value,
        details: resultRecord.details,
      };
      hidden = matches.hidden;
      noun = "matches";
      direction = "head";
      break;
    }

    case "ls": {
      const sorted = sortEntries(arrayField(resultRecord.entries) ?? []);
      const entries = firstItems(sorted);
      resultPreview = {
        path: resultRecord.path,
        entries: entries.value,
        details: resultRecord.details,
      };
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

    case "python":
    case "python_exec": {
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
      const diff = lastLines(editDiff(resultRecord));
      const output = lastLines(outputText(resultRecord));
      const textResult = withTextContent(resultRecord, output.value);
      resultPreview = {
        ...textResult,
        details: editDetailsPreview(resultRecord.details, diff.value),
      };
      ({ hidden, noun } = textOverflowStats([diff, output]));
      direction = "tail";
      break;
    }

    case "explain_image": {
      const details = record(resultRecord.details);
      const explanation = firstLines(
        stringField(details.explanation) ?? outputText(resultRecord),
      );
      resultPreview = {
        ...withTextContent(resultRecord, explanation.value),
        details: {
          ...details,
          explanation: explanation.value ?? "",
        },
      };
      ({ hidden, noun } = textOverflowStats([explanation]));
      direction = "head";
      break;
    }

    case "explore": {
      const reports = firstItems(
        arrayField<Record<string, unknown>>(resultRecord.reports),
      );
      resultPreview = {
        reports: reports.value?.map(exploreReportPreview),
        details: resultRecord.details,
      };
      hidden = reports.hidden;
      noun = "reports";
      direction = "head";
      break;
    }

    case "web_search":
    case "web_fetch": {
      const preview =
        toolName === "web_search"
          ? buildWebSearchTranscriptPreview(resultRecord)
          : buildWebFetchTranscriptPreview(resultRecord);
      ({ resultPreview, hidden, noun, direction, semanticOverflow } = preview);
      break;
    }

    case "task_logs": {
      const output = lastLines(
        stringField(resultRecord.output) ?? outputText(resultRecord),
      );
      resultPreview =
        "output" in resultRecord
          ? { bashId: resultRecord.bashId, output: output.value }
          : withTextContent(resultRecord, output.value);
      ({ hidden, noun } = textOverflowStats([output]));
      direction = "tail";
      break;
    }
    case "task_start":
    case "task_control":
    case "task_status": {
      const summary = (value: unknown) => {
        const row = record(value);
        return {
          id: row.id,
          status: row.status,
          command: row.command,
          cwd: row.workingDirectory ?? row.cwd,
          startedAt: row.startedAt,
          exitCode: row.exitCode,
          finishedAt: row.finishedAt,
        };
      };
      const rows = Array.isArray(publicResult)
        ? firstItems(publicResult)
        : undefined;
      resultPreview = rows
        ? rows.value?.map(summary)
        : resultRecord.asyncBash
          ? {
              asyncBash: summary(resultRecord.asyncBash),
              readiness: resultRecord.readiness,
            }
          : summary(publicResult);
      hidden = rows?.hidden ?? 0;
      noun = "tasks";
      direction = "head";
      break;
    }
    case "subagent_new":
    case "subagent_prompt":
    case "subagent_status": {
      const bounded = previewUnknown(publicResult);
      resultPreview = bounded.value;
      ({ hidden, noun } = unknownOverflowStats([bounded]));
      direction = "head";
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
      const argsBound = previewUnknown(args);
      const resultBound = previewUnknown(publicResult);
      argsPreview = argsBound.value;
      resultPreview = resultBound.value;
      ({ hidden, noun } = unknownOverflowStats([argsBound, resultBound]));
      direction = "head";
      break;
    }

    default: {
      const argsBound = previewUnknown(args);
      const resultBound = previewUnknown(publicResult);
      argsPreview = argsBound.value;
      resultPreview = resultBound.value;
      ({ hidden, noun } = unknownOverflowStats([argsBound, resultBound]));
      direction = "head";
    }
  }

  const resultFirst =
    toolName === "explore" ||
    toolName.startsWith("task_") ||
    toolName.startsWith("subagent_") ||
    toolName.startsWith("web_") ||
    toolName === "explain_image";
  const finalized = finalizePublicPreview(
    argsPreview,
    resultPreview,
    resultFirst,
  );
  if (!semanticOverflow) {
    if (finalized.hiddenItems > 0) {
      hidden += finalized.hiddenItems;
      noun = "items";
    } else if (finalized.hiddenChars > 0) {
      hidden += finalized.hiddenChars;
      noun = "characters";
    }
  }
  return {
    argsPreview: JSON.parse(JSON.stringify(finalized.argsPreview ?? null)),
    resultPreview: JSON.parse(JSON.stringify(finalized.resultPreview ?? null)),
    previewOverflow: overflow(hidden, noun, direction),
  };
}
