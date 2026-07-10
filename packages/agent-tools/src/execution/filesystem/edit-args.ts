import { argumentError } from "./edit-errors.js";
import type { MatchMode } from "./smart-match.js";

export type EditOperationType =
  | "replace_text"
  | "insert_text"
  | "replace_lines"
  | "insert_lines"
  | "apply_patch";

export type EditOperationSourceKey =
  | "replacements"
  | "insertions"
  | "lineReplacements"
  | "lineInsertions"
  | "patch";

export type EditOperationSource = {
  key: EditOperationSourceKey;
  index: number;
  label: string;
};

export type NormalizedEditOperation =
  | {
      type: "replace_text";
      oldText: string;
      newText: string;
      matchMode: MatchMode;
      occurrence?: number;
      source: EditOperationSource;
    }
  | {
      type: "insert_text";
      anchor: string;
      position: "before" | "after";
      text: string;
      matchMode: MatchMode;
      occurrence?: number;
      source: EditOperationSource;
    }
  | {
      type: "replace_lines";
      startLine: number;
      endLine: number;
      newText: string;
      source: EditOperationSource;
    }
  | {
      type: "insert_lines";
      line: number;
      position: "before" | "after";
      text: string;
      source: EditOperationSource;
    }
  | { type: "apply_patch"; patch: string; source: EditOperationSource };

export type NormalizedEditArgs = {
  dryRun: boolean;
  operations: NormalizedEditOperation[];
};

const matchModes = new Set<MatchMode>(["exact", "trimmed", "whitespace"]);
const positions = new Set(["before", "after"]);

export function normalizeEditArgs(
  args: Record<string, unknown>,
): NormalizedEditArgs {
  const dryRun = booleanArg(args.dryRun, false, "dryRun");
  rejectDeprecatedEditArgs(args);

  const operations: NormalizedEditOperation[] = [];
  const replacements = arrayArg(args.replacements, "replacements");
  const insertions = arrayArg(args.insertions, "insertions");
  const lineReplacements = arrayArg(args.lineReplacements, "lineReplacements");
  const lineInsertions = arrayArg(args.lineInsertions, "lineInsertions");
  const patch = optionalStringArg(args.patch, "patch");
  const hasArrayEdits = Boolean(
    replacements || insertions || lineReplacements || lineInsertions,
  );

  if (patch !== undefined && hasArrayEdits) {
    throw argumentError(
      "Tool argument 'patch' must not be combined with replacements, insertions, lineReplacements, or lineInsertions.",
      { hasPatch: true },
    );
  }

  if (replacements) {
    operations.push(...replacements.map(normalizeReplacement));
  }
  if (insertions) {
    operations.push(...insertions.map(normalizeInsertion));
  }
  if (lineReplacements) {
    operations.push(...lineReplacements.map(normalizeLineReplacement));
  }
  if (lineInsertions) {
    operations.push(...lineInsertions.map(normalizeLineInsertion));
  }
  if (patch !== undefined) {
    operations.push({
      type: "apply_patch",
      patch: nonEmptyStringArg(patch, "patch"),
      source: sourceFor("patch", 0),
    });
  }

  if (operations.length === 0) {
    throw argumentError(
      "Provide at least one edit using replacements, insertions, lineReplacements, lineInsertions, or patch.",
    );
  }

  return { dryRun, operations };
}

function rejectDeprecatedEditArgs(args: Record<string, unknown>): void {
  if (args.operations !== undefined) {
    throw argumentError(
      "Tool argument 'operations' is no longer supported; use replacements, insertions, lineReplacements, lineInsertions, or patch.",
    );
  }
  if (args.oldText !== undefined || args.newText !== undefined) {
    throw argumentError(
      "Top-level oldText/newText are no longer supported for edit; use replacements: [{ oldText, newText }].",
    );
  }
}

function arrayArg(
  value: unknown,
  name: EditOperationSourceKey,
): unknown[] | undefined {
  if (value === undefined) return undefined;
  const parsed = parseArrayValue(value);
  if (!Array.isArray(parsed)) {
    throw argumentError(`Tool argument '${name}' must be an array.`, {
      source: name,
    });
  }
  if (parsed.length === 0) {
    throw argumentError(
      `Tool argument '${name}' must contain at least one item.`,
      {
        source: name,
      },
    );
  }
  return parsed;
}

function parseArrayValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeReplacement(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `replacements[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, [
    "oldText",
    "newText",
    "matchMode",
    "occurrence",
  ]);
  const operation = {
    type: "replace_text" as const,
    oldText: nonEmptyStringArg(record.oldText, `${label}.oldText`),
    newText: stringArg(record.newText, `${label}.newText`),
    matchMode: matchModeArg(record.matchMode, `${label}.matchMode`),
    source: sourceFor("replacements", index),
  };
  const occurrence = optionalPositiveIntegerArg(
    record.occurrence,
    `${label}.occurrence`,
  );
  return occurrence === undefined ? operation : { ...operation, occurrence };
}

function normalizeInsertion(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `insertions[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, [
    "anchor",
    "position",
    "text",
    "matchMode",
    "occurrence",
  ]);
  const operation = {
    type: "insert_text" as const,
    anchor: nonEmptyStringArg(record.anchor, `${label}.anchor`),
    position: positionArg(record.position, `${label}.position`),
    text: stringArg(record.text, `${label}.text`),
    matchMode: matchModeArg(record.matchMode, `${label}.matchMode`),
    source: sourceFor("insertions", index),
  };
  const occurrence = optionalPositiveIntegerArg(
    record.occurrence,
    `${label}.occurrence`,
  );
  return occurrence === undefined ? operation : { ...operation, occurrence };
}

function normalizeLineReplacement(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `lineReplacements[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, ["startLine", "endLine", "newText"]);
  return {
    type: "replace_lines",
    startLine: positiveIntegerArg(record.startLine, `${label}.startLine`),
    endLine: positiveIntegerArg(record.endLine, `${label}.endLine`),
    newText: stringArg(record.newText, `${label}.newText`),
    source: sourceFor("lineReplacements", index),
  };
}

function normalizeLineInsertion(
  entry: unknown,
  index: number,
): NormalizedEditOperation {
  const label = `lineInsertions[${index}]`;
  const record = objectArg(entry, label);
  assertAllowedFields(record, label, ["line", "position", "text"]);
  return {
    type: "insert_lines",
    line: positiveIntegerArg(record.line, `${label}.line`),
    position: positionArg(record.position, `${label}.position`),
    text: stringArg(record.text, `${label}.text`),
    source: sourceFor("lineInsertions", index),
  };
}

function objectArg(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw argumentError(`${label} must be an object.`, { sourceLabel: label });
  }
  return value as Record<string, unknown>;
}

function sourceFor(
  key: EditOperationSourceKey,
  index: number,
): EditOperationSource {
  return {
    key,
    index,
    label: key === "patch" ? "patch" : `${key}[${index}]`,
  };
}

function assertAllowedFields(
  record: Record<string, unknown>,
  label: string,
  allowed: string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unexpected.length === 0) return;
  throw argumentError(
    `${label} has unsupported field(s): ${unexpected.join(", ")}.`,
    { sourceLabel: label, unexpected },
  );
}

function booleanArg(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw argumentError(`Tool argument '${name}' must be a boolean.`);
  }
  return value;
}

function optionalStringArg(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return stringArg(value, name);
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw argumentError(`${name} must be a string.`);
  }
  return value;
}

function nonEmptyStringArg(value: unknown, name: string): string {
  const text = stringArg(value, name);
  if (text.length === 0) {
    throw argumentError(`${name} must be a non-empty string.`);
  }
  return text;
}

function positiveIntegerArg(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw argumentError(`${name} must be a positive integer.`);
  }
  return value;
}

function optionalPositiveIntegerArg(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  return positiveIntegerArg(value, name);
}

function positionArg(value: unknown, name: string): "before" | "after" {
  if (typeof value !== "string" || !positions.has(value)) {
    throw argumentError(`${name} must be either "before" or "after".`);
  }
  return value as "before" | "after";
}

function matchModeArg(value: unknown, name: string): MatchMode {
  if (value === undefined) return "exact";
  if (typeof value !== "string" || !matchModes.has(value as MatchMode)) {
    throw argumentError(`${name} must be one of exact, trimmed, whitespace.`, {
      matchMode: value,
    });
  }
  return value as MatchMode;
}
