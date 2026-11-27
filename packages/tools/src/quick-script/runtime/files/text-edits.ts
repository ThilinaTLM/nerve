import {
  ambiguousMessage,
  exactMatchOffsets,
  notFoundMessage,
} from "../../../execution/filesystem/edit.js";
import { normalizeLineEndings } from "../../../execution/filesystem/text-editing.js";

/**
 * The edit operations of `files.edit` and `artifacts.edit`: pure functions over
 * text whose line endings are already normalized to `\n`. Edits apply in list
 * order, each to the result of the previous one.
 */

export type TextEdit =
  | { kind: "exact"; oldText: string; newText: string; all: boolean }
  | {
      kind: "regex";
      source: string;
      flags: string;
      replacement: string;
      all: boolean;
    }
  | {
      kind: "range";
      from: string;
      to: string;
      /** `through` (the end anchor is replaced) versus `upTo` (it is kept). */
      inclusive: boolean;
      newText: string;
    }
  | { kind: "insert"; anchor: string; before: boolean; text: string };

export type ParsedEdit = {
  index: number;
  edit: TextEdit;
  /** Exact number of matches expected; only with `all`. */
  count?: number;
};

const SHAPES: { key: string; kind: TextEdit["kind"]; fields: string[] }[] = [
  {
    key: "oldText",
    kind: "exact",
    fields: ["oldText", "newText", "all", "count"],
  },
  {
    key: "pattern",
    kind: "regex",
    fields: ["pattern", "flags", "replacement", "all", "count"],
  },
  {
    key: "from",
    kind: "range",
    fields: ["from", "through", "upTo", "newText"],
  },
  { key: "insertBefore", kind: "insert", fields: ["insertBefore", "text"] },
  { key: "insertAfter", kind: "insert", fields: ["insertAfter", "text"] },
];

const SHAPE_HINT =
  "{ oldText, newText, all?, count? }, { pattern, replacement, flags?, all?, count? }, { from, through | upTo, newText } or { insertBefore | insertAfter, text }";

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string.`);
  return normalizeLineEndings(value);
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return normalizeLineEndings(value);
};

/** Validates one edit; `targetFields` are the extra keys the caller handles (`path`, `glob`). */
export function parseEdit(
  raw: unknown,
  index: number,
  targetFields: readonly string[],
): ParsedEdit {
  const label = `edits[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${label} must be an object: ${SHAPE_HINT}.`);
  const record = raw as Record<string, unknown>;
  const shapes = SHAPES.filter((shape) => shape.key in record);
  if (shapes.length !== 1)
    throw new Error(
      `${label} must have exactly one of oldText, pattern, from, insertBefore or insertAfter: ${SHAPE_HINT}.`,
    );
  const shape = shapes[0];
  const allowed = new Set([...shape.fields, ...targetFields]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0)
    throw new Error(
      `${label} has unknown field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}; this edit takes ${[...allowed].join(", ")}.`,
    );
  const all = record.all === undefined ? false : record.all;
  if (typeof all !== "boolean")
    throw new Error(`${label}.all must be a boolean.`);
  let count: number | undefined;
  if (record.count !== undefined) {
    if (!all)
      throw new Error(
        `${label}.count needs all: true; without it the edit must match exactly once.`,
      );
    if (!Number.isInteger(record.count) || (record.count as number) < 1)
      throw new Error(`${label}.count must be a positive integer.`);
    count = record.count as number;
  }
  switch (shape.kind) {
    case "exact": {
      const oldText = nonEmpty(record.oldText, `${label}.oldText`);
      const newText = text(record.newText, `${label}.newText`);
      if (oldText === newText)
        throw new Error(`${label}: oldText equals newText.`);
      return { index, count, edit: { kind: "exact", oldText, newText, all } };
    }
    case "regex": {
      const source = nonEmpty(record.pattern, `${label}.pattern`);
      const flags = record.flags === undefined ? "" : record.flags;
      if (
        typeof flags !== "string" ||
        /[^dimsuv]/.test(flags.replace(/[gy]/g, ""))
      )
        throw new Error(`${label}.flags must use only d, i, m, s, u or v.`);
      const clean = flags.replace(/[gy]/g, "");
      try {
        new RegExp(source, clean);
      } catch (error) {
        throw new Error(
          `${label}.pattern is not a valid regular expression: ${(error as Error).message}`,
          { cause: error },
        );
      }
      const replacement = text(record.replacement, `${label}.replacement`);
      return {
        index,
        count,
        edit: { kind: "regex", source, flags: clean, replacement, all },
      };
    }
    case "range": {
      if ("through" in record === "upTo" in record)
        throw new Error(
          `${label} needs exactly one of through (replaces the end anchor too) or upTo (keeps it).`,
        );
      const inclusive = "through" in record;
      return {
        index,
        edit: {
          kind: "range",
          from: nonEmpty(record.from, `${label}.from`),
          to: nonEmpty(
            inclusive ? record.through : record.upTo,
            `${label}.${inclusive ? "through" : "upTo"}`,
          ),
          inclusive,
          newText: text(record.newText, `${label}.newText`),
        },
      };
    }
    case "insert": {
      const before = "insertBefore" in record;
      return {
        index,
        edit: {
          kind: "insert",
          anchor: nonEmpty(
            before ? record.insertBefore : record.insertAfter,
            `${label}.${before ? "insertBefore" : "insertAfter"}`,
          ),
          before,
          text: text(record.text, `${label}.text`),
        },
      };
    }
  }
}

/** The text an edit looks for, for the authorization record and messages. */
export function editNeedle(edit: TextEdit): string {
  switch (edit.kind) {
    case "exact":
      return edit.oldText;
    case "regex":
      return `/${edit.source}/${edit.flags}`;
    case "range":
      return edit.from;
    case "insert":
      return edit.anchor;
  }
}

/** The text an edit writes. */
export function editReplacement(edit: TextEdit): string {
  return edit.kind === "regex"
    ? edit.replacement
    : edit.kind === "insert"
      ? edit.text
      : edit.newText;
}

export class EditMismatch extends Error {}

/**
 * Applies one edit. `optional` (glob edits) lets a file without a match pass
 * unchanged; a match that is ambiguous still fails. Returns the new text and
 * the number of matches.
 */
export function applyEdit(
  content: string,
  { index, edit, count }: ParsedEdit,
  shown: string,
  optional: boolean,
): { text: string; matches: number } {
  const unique = (needle: string, field: string): number | undefined => {
    const offsets = exactMatchOffsets(content, needle);
    if (offsets.length === 0) {
      if (optional) return undefined;
      throw new EditMismatch(
        notFoundMessage(content, needle, index, shown, field),
      );
    }
    if (offsets.length > 1)
      throw new EditMismatch(
        `${shown}: ${ambiguousMessage(content, offsets, index, field)}`,
      );
    return offsets[0];
  };
  const counted = (matches: number, field: string) => {
    if (optional && matches === 0) return;
    if (count !== undefined && !optional && matches !== count)
      throw new EditMismatch(
        `edits[${index}].${field} matched ${matches} times in ${shown}; count is ${count}.`,
      );
    if (matches === 0)
      throw new EditMismatch(
        `edits[${index}].${field} matched nothing in ${shown}.`,
      );
  };

  switch (edit.kind) {
    case "exact": {
      if (!edit.all) {
        const at = unique(edit.oldText, "oldText");
        if (at === undefined) return { text: content, matches: 0 };
        return {
          text:
            content.slice(0, at) +
            edit.newText +
            content.slice(at + edit.oldText.length),
          matches: 1,
        };
      }
      const matches = exactMatchOffsets(content, edit.oldText).length;
      if (matches === 0 && !optional)
        throw new EditMismatch(
          notFoundMessage(content, edit.oldText, index, shown),
        );
      counted(matches, "oldText");
      return { text: content.split(edit.oldText).join(edit.newText), matches };
    }
    case "regex": {
      const global = new RegExp(edit.source, `${edit.flags}g`);
      const matches = [...content.matchAll(global)].length;
      if (!edit.all) {
        if (matches === 0 && optional) return { text: content, matches: 0 };
        if (matches !== 1)
          throw new EditMismatch(
            `edits[${index}].pattern matched ${matches} times in ${shown}; without all: true it must match exactly once.`,
          );
        return {
          text: content.replace(
            new RegExp(edit.source, edit.flags),
            edit.replacement,
          ),
          matches,
        };
      }
      counted(matches, "pattern");
      return { text: content.replace(global, edit.replacement), matches };
    }
    case "range": {
      const start = unique(edit.from, "from");
      if (start === undefined) return { text: content, matches: 0 };
      const field = edit.inclusive ? "through" : "upTo";
      const end = content.indexOf(edit.to, start + edit.from.length);
      if (end < 0)
        throw new EditMismatch(
          `edits[${index}].${field} was not found after edits[${index}].from in ${shown}.`,
        );
      const stop = edit.inclusive ? end + edit.to.length : end;
      return {
        text: content.slice(0, start) + edit.newText + content.slice(stop),
        matches: 1,
      };
    }
    case "insert": {
      const field = edit.before ? "insertBefore" : "insertAfter";
      const at = unique(edit.anchor, field);
      if (at === undefined) return { text: content, matches: 0 };
      const point = edit.before ? at : at + edit.anchor.length;
      return {
        text: content.slice(0, point) + edit.text + content.slice(point),
        matches: 1,
      };
    }
  }
}
