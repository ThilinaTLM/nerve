import type { LiveToolCallDraft } from "$lib/stores/workbench/state.svelte";

export type DraftMetaTone =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info";

export type DraftMetaItem = {
  text: string;
  tone?: DraftMetaTone;
  mono?: boolean;
};

export type ToolDraftSummary = {
  kind: "write" | "edit" | "generic";
  toolName: string;
  path?: string;
  statusText: string;
  meta: DraftMetaItem[];
  lineCount?: number;
  replacementCount?: number;
  generatedLineCount?: number;
  done: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function plural(count: number, singular: string, suffix = "s"): string {
  return `${count} ${singular}${count === 1 ? "" : suffix}`;
}

function lineCount(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function propertyValuePattern(property: string): RegExp {
  return new RegExp(`"${escapeRegExp(property)}"\\s*:\\s*"`, "g");
}

function extractJsonStringValues(
  text: string,
  property: string,
  options: { maxChars?: number } = {},
): string[] {
  const values: string[] = [];
  const pattern = propertyValuePattern(property);
  let match = pattern.exec(text);
  while (match) {
    const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
    let value = "";
    let index = match.index + match[0].length;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        const escaped = text[index + 1];
        if (value.length < maxChars) {
          if (escaped === "n") value += "\n";
          else if (escaped === "r") value += "\r";
          else if (escaped === "t") value += "\t";
          else value += escaped;
        }
        index += 2;
        continue;
      }
      if (char === '"') break;
      if (value.length < maxChars) value += char;
      index += 1;
    }
    values.push(value);
    match = pattern.exec(text);
  }
  return values;
}

function lineCountsForJsonStringValues(
  text: string,
  property: string,
): number[] {
  const counts: number[] = [];
  const pattern = propertyValuePattern(property);
  let match = pattern.exec(text);
  while (match) {
    let lines = 0;
    let sawContent = false;
    let index = match.index + match[0].length;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        const escaped = text[index + 1];
        if (escaped === "n") {
          lines = Math.max(lines, 1) + 1;
          sawContent = true;
        } else if (escaped !== "r") {
          sawContent = true;
        }
        index += 2;
        continue;
      }
      if (char === '"') break;
      if (char === "\n") {
        lines = Math.max(lines, 1) + 1;
      } else if (char !== "\r") {
        sawContent = true;
      }
      index += 1;
    }
    counts.push(Math.max(lines, sawContent ? 1 : 0));
    match = pattern.exec(text);
  }
  return counts;
}

function countPropertyStarts(text: string, property: string): number {
  const pattern = propertyValuePattern(property);
  let count = 0;
  while (pattern.exec(text)) count += 1;
  return count;
}

function firstPathFromDraft(draft: LiveToolCallDraft): string | undefined {
  const args = asRecord(draft.args);
  return (
    stringField(args.path) ??
    extractJsonStringValues(draft.argsText, "path", { maxChars: 240 })[0]
  );
}

function summarizeWriteDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalContent = stringField(args.content);
  const partialContentLines = lineCountsForJsonStringValues(
    draft.argsText,
    "content",
  )[0];
  const lines = lineCount(finalContent) ?? partialContentLines;
  const meta: DraftMetaItem[] = [];
  if (lines !== undefined && lines > 0) {
    meta.push({ text: plural(lines, "line"), tone: "info" });
  }
  if (draft.done) meta.push({ text: "submitted", tone: "success" });
  return {
    kind: "write",
    toolName: "write",
    path: firstPathFromDraft(draft),
    statusText: draft.done
      ? "Submitting write arguments…"
      : "Generating content…",
    meta,
    lineCount: lines,
    done: Boolean(draft.done),
  };
}

function finalEditStats(
  args: Record<string, unknown>,
): { replacements: number; generatedLines: number } | undefined {
  if (!Array.isArray(args.edits)) return undefined;
  let generatedLines = 0;
  for (const edit of args.edits) {
    const count = lineCount(stringField(asRecord(edit).newText));
    generatedLines += count ?? 0;
  }
  return { replacements: args.edits.length, generatedLines };
}

function partialEditStats(argsText: string): {
  replacements: number;
  generatedLines: number;
} {
  const newTextLines = lineCountsForJsonStringValues(argsText, "newText");
  const replacements = Math.max(
    newTextLines.length,
    countPropertyStarts(argsText, "oldText"),
  );
  return {
    replacements,
    generatedLines: newTextLines.reduce((total, count) => total + count, 0),
  };
}

function summarizeEditDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  const args = asRecord(draft.args);
  const finalStats = finalEditStats(args);
  const partialStats = finalStats ?? partialEditStats(draft.argsText);
  const meta: DraftMetaItem[] = [];
  if (partialStats.replacements > 0) {
    meta.push({ text: plural(partialStats.replacements, "replacement") });
  }
  if (partialStats.generatedLines > 0) {
    meta.push({
      text: plural(partialStats.generatedLines, "generated line"),
      tone: "info",
    });
  }
  if (draft.done) meta.push({ text: "submitted", tone: "success" });
  return {
    kind: "edit",
    toolName: "edit",
    path: firstPathFromDraft(draft),
    statusText: draft.done ? "Submitting edit arguments…" : "Generating edits…",
    meta,
    replacementCount: partialStats.replacements,
    generatedLineCount: partialStats.generatedLines,
    done: Boolean(draft.done),
  };
}

export function summarizeToolDraft(draft: LiveToolCallDraft): ToolDraftSummary {
  if (draft.toolName === "write") return summarizeWriteDraft(draft);
  if (draft.toolName === "edit") return summarizeEditDraft(draft);
  const toolName = draft.toolName ?? "tool";
  return {
    kind: "generic",
    toolName,
    statusText: draft.done
      ? `${toolName} arguments prepared.`
      : `Preparing ${toolName} arguments…`,
    meta: draft.done ? [{ text: "submitted", tone: "success" }] : [],
    done: Boolean(draft.done),
  };
}
