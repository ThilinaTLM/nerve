import type { ToolArgumentSource } from "./argument-source";
import type { ToolArgumentBody } from "./types";

/**
 * Builder for the structured Jira/Confluence draft body. Pure so the field
 * bounding and streaming semantics stay unit-testable under the node runner.
 */

type AtlassianDraftBodyKind = Extract<
  ToolArgumentBody,
  { kind: "atlassian-draft" }
>;

export type AtlassianDraftField = AtlassianDraftBodyKind["fields"][number];
export type AtlassianDraftText = NonNullable<AtlassianDraftBodyKind["text"]>;

const FIELD_VALUE_MAX_CHARS = 300;
const TEXT_TAIL_MAX_CHARS = 6_000;

function boundFieldValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= FIELD_VALUE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, FIELD_VALUE_MAX_CHARS - 1)}…`;
}

function boundTextTail(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= TEXT_TAIL_MAX_CHARS) return text;
  return text.slice(-TEXT_TAIL_MAX_CHARS);
}

type DraftFieldOptions = Pick<AtlassianDraftField, "mono" | "tone">;

/** Field row that is always present; pending (skeleton) while value is undefined. */
export function draftField(
  label: string,
  value: string | undefined,
  options: DraftFieldOptions = {},
): AtlassianDraftField {
  return { label, value, ...options };
}

/** Field row included only once its value exists (no skeleton placeholder). */
export function optionalDraftField(
  label: string,
  value: string | undefined,
  options: DraftFieldOptions = {},
): AtlassianDraftField[] {
  if (value === undefined || value === "") return [];
  return [{ label, value, ...options }];
}

/** `Mode: dry run` row for mutation drafts, present only when requested. */
export function dryRunField(source: ToolArgumentSource): AtlassianDraftField[] {
  return source.boolean("dry_run") === true
    ? [{ label: "Mode", value: "dry run", tone: "info" }]
    : [];
}

export function atlassianDraftBody(input: {
  fields: AtlassianDraftField[];
  text?: AtlassianDraftText;
}): ToolArgumentBody {
  const seen = new Set<string>();
  const fields = input.fields.flatMap((field) => {
    if (seen.has(field.label)) return [];
    seen.add(field.label);
    return [{ ...field, value: boundFieldValue(field.value) }];
  });
  const text = input.text
    ? { ...input.text, text: boundTextTail(input.text.text) }
    : undefined;
  if (fields.length === 0 && !text) return { kind: "none" };
  return { kind: "atlassian-draft", fields, text };
}

/** Line count of a streaming text value, for `+N` draft meta chips. */
export function streamedLineCount(
  text: string | undefined,
): number | undefined {
  if (text === undefined || text.length === 0) return undefined;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length;
}
