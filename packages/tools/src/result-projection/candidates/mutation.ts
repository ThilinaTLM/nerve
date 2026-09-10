import { validContentBlocks } from "../fallback.js";
import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { artifacts } from "../candidate-artifacts.js";
import {
  semanticSummary,
  pickSemantic,
  formatFlat,
} from "../candidate-semantic-text.js";
import {
  textOf,
  record,
  array,
  string,
  number,
  firstString,
} from "../candidate-values.js";

export function mutationCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const summary = record(details.mutationSummary);
  const lines: string[] = [];
  const transitions = array(details.transitions) ?? [];
  if (Object.keys(summary).length > 0) {
    lines.push(
      `Operation: ${string(summary.operation) || context.toolName}`,
      `Outcome: ${mutationOutcomeText(string(summary.outcome))}`,
    );
    for (const resource of array(summary.resources) ?? []) {
      const value = record(resource);
      const identity = firstString(value.key, value.id, value.path, value.url);
      if (identity)
        lines.push(`${string(value.kind) || "resource"}: ${identity}`);
    }
    for (const warning of array(summary.warnings) ?? [])
      lines.push(`Warning: ${String(warning)}`);
    if (typeof summary.nextAction === "string")
      lines.push(`Next action: ${summary.nextAction}`);
    if (number(details.bytesWritten) !== undefined)
      lines.push(`Bytes written: ${String(details.bytesWritten)}`);
    if (number(details.operationCount) !== undefined)
      lines.push(`Operations: ${String(details.operationCount)}`);
    if (number(details.firstChangedLine) !== undefined)
      lines.push(`First changed line: ${String(details.firstChangedLine)}`);
  } else {
    const content = validContentBlocks(result)
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (content && transitions.length === 0) lines.push(content);
    const safe = pickSemantic({ ...result, ...details }, [
      "operation",
      "action",
      "outcome",
      "success",
      "dryRun",
      "path",
      "bytes",
      "bytesWritten",
      "id",
      "key",
      "issueKey",
      "pageId",
      "attachmentId",
      "status",
      "state",
      "version",
      "url",
      "warning",
      "warnings",
      "error",
      "message",
      "mode",
      "planPath",
      "reviewId",
      "operationCount",
      "firstChangedLine",
    ]);
    if (Object.keys(safe).length > 0) lines.push(formatFlat(safe));
  }
  const items = transitions.slice(0, 10).map((value, index) => ({
    id: String(index),
    countsAs: "item" as const,
    blocks: [
      { type: "text" as const, text: semanticSummary(value, index + 1) },
    ],
  }));
  if (items.length > 0) {
    lines.push(
      "Available transitions:",
      ...items.map((item) => textOf(item.blocks)),
    );
  }
  const text = lines.filter(Boolean).join("\n") || "Operation completed.";
  return {
    blocks: [{ type: "text", text }],
    status: [{ type: "text", text: lines.slice(0, 6).join("\n") }],
    ...(items.length > 0 ? { items, overflow: { noun: "transition" } } : {}),
    artifacts: artifacts(context),
  };
}

function mutationOutcomeText(outcome: string): string {
  if (outcome === "dry_run") return "dry run; operation not performed";
  if (outcome === "partial") return "partially succeeded";
  if (outcome === "succeeded") return "succeeded";
  return outcome || "completed";
}
