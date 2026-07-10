import {
  type TodoItem,
  toolExecutionResultSchema,
  toolOutputLimitsSchema,
  truncationDetailsSchema,
} from "@nervekit/contracts";
import {
  relativePathForDisplay,
  resolveDisplayPath,
} from "@nervekit/ui-kit/core/utils/path-links";
import { trimTextPreview } from "@nervekit/ui-kit/core/utils/text-preview";
import type { LiveToolOutput } from "../../state/transcript-types";
import type { GrepMatchView, GroupedMatches } from "./tool-view-types";

/** Lines/items shown before the footer "Show more" toggle expands a body. */
export const COLLAPSED_LINES = 10;
const GREP_MATCH_TEXT_MAX = 260;

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to the empty record for non-JSON strings.
    }
  }
  return {};
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const EXECUTION_RESULT_COPY_KEYS = [
  "path",
  "entries",
  "matches",
  "stdout",
  "stderr",
  "exitCode",
] as const;

function textContentArray(value: unknown): string | undefined {
  const blocks = asRecord(value).content;
  if (!Array.isArray(blocks)) return undefined;
  const texts = blocks.flatMap((block) => {
    const record = asRecord(block);
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function executionResultFromAgentToolResult(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const content = textContentArray(record);
  if (content === undefined) return undefined;
  const result: Record<string, unknown> = { content };
  const contentBlocks = record.content;
  if (Array.isArray(contentBlocks)) result.contentBlocks = contentBlocks;
  const details = asRecord(record.details);
  for (const key of EXECUTION_RESULT_COPY_KEYS) {
    if (details[key] !== undefined) result[key] = details[key];
  }
  if (record.details !== undefined) result.details = record.details;
  return result;
}

export function parseToolExecutionResult(value: unknown) {
  const direct = toolExecutionResultSchema.safeParse(value);
  if (direct.success) return direct.data;
  const parsedRecord = asRecord(value);
  if (Object.keys(parsedRecord).length === 0) return undefined;
  const agentResult = executionResultFromAgentToolResult(parsedRecord);
  if (agentResult) {
    const parsedAgentResult = toolExecutionResultSchema.safeParse(agentResult);
    if (parsedAgentResult.success) return parsedAgentResult.data;
  }
  const parsed = toolExecutionResultSchema.safeParse(parsedRecord);
  return parsed.success ? parsed.data : undefined;
}

function textContentBlocks(value: unknown): string | undefined {
  const blocks = asRecord(value).contentBlocks;
  if (!Array.isArray(blocks)) return undefined;
  const texts = blocks.flatMap((block) => {
    const record = asRecord(block);
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function combinedStreamOutput(value: unknown): string | undefined {
  const record = asRecord(value);
  const stdout = stringField(record.stdout);
  const stderr = stringField(record.stderr);
  if (stdout === undefined && stderr === undefined) return undefined;
  if (!stdout) return stderr && stderr.length > 0 ? stderr : undefined;
  if (!stderr) return stdout.length > 0 ? stdout : undefined;
  return stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}\n${stderr}`;
}

export function resultOutputText(
  result: ReturnType<typeof parseToolExecutionResult>,
  rawResult: unknown,
  liveOutput?: LiveToolOutput,
): string {
  return (
    result?.content ??
    textContentBlocks(result) ??
    textContentBlocks(rawResult) ??
    combinedStreamOutput(result) ??
    combinedStreamOutput(rawResult) ??
    liveOutput?.text ??
    ""
  );
}

export function todoItemsField(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TodoItem[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (typeof record.todo !== "string" || typeof record.done !== "boolean") {
      return undefined;
    }
    items.push({ todo: record.todo, done: record.done });
  }
  return items;
}

export function firstTextBlock(value: unknown): string | undefined {
  const blocks = asRecord(value).contentBlocks;
  if (!Array.isArray(blocks)) return undefined;
  const textBlock = blocks.find(
    (block) =>
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string",
  ) as { text?: string } | undefined;
  return textBlock?.text;
}

export function relativePath(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  if (path === cwd) return ".";
  return relativePathForDisplay(path, cwd);
}

export function tail<T>(items: T[], count: number): T[] {
  return items.length > count ? items.slice(items.length - count) : items;
}

export function imageDataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function trimMatchText(match: GrepMatchView): GrepMatchView {
  return {
    ...match,
    text: trimTextPreview(match.text, {
      headLines: 2,
      tailLines: 1,
      maxChars: GREP_MATCH_TEXT_MAX,
    }).text,
  };
}

export { trimMatchText };

export function groupMatchesByFile(matches: GrepMatchView[]): GroupedMatches[] {
  const groups: GroupedMatches[] = [];
  const byPath = new Map<string, GrepMatchView[]>();
  for (const match of matches) {
    let bucket = byPath.get(match.path);
    if (!bucket) {
      bucket = [];
      byPath.set(match.path, bucket);
      groups.push({
        path: match.path,
        openPath: match.openPath,
        matches: bucket,
      });
    }
    bucket.push(match);
  }
  return groups;
}

export function resolveToolPath(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  return resolveDisplayPath(path, cwd);
}

export function outputLimitsFromDetails(details: unknown) {
  const record = asRecord(details);
  const direct = toolOutputLimitsSchema.safeParse(record.outputLimits);
  if (direct.success) return direct.data;
  return undefined;
}

export function outputArtifactsFromDetails(details: unknown) {
  return outputLimitsFromDetails(details)?.artifacts ?? [];
}

export function detailsTruncated(details: unknown): boolean {
  const record = asRecord(details);
  const direct = truncationDetailsSchema.safeParse(details);
  if (direct.success && direct.data.truncated) return true;
  const nested = truncationDetailsSchema.safeParse(record.truncation);
  return Boolean(nested.success && nested.data.truncated);
}

export function diffStats(diff: string | undefined): {
  additions: number;
  deletions: number;
} {
  if (!diff) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}
