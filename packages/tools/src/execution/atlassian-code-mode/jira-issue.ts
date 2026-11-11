import { adfToMarkdown } from "../jira/adf-markdown.js";
import { closeMatches } from "./sdk-args.js";

/** Standard Jira fields the SDK flattens. Everything else is a custom field keyed by name. */
const STANDARD_FIELD_IDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "created",
  "updated",
  "resolution",
  "labels",
  "components",
  "fixVersions",
  "parent",
  "description",
] as const;
type StandardFieldId = (typeof STANDARD_FIELD_IDS)[number];

/** Structured system fields: simplified when explicitly requested, never in the defaults. */
const STRUCTURED_FIELD_IDS = [
  "comment",
  "attachment",
  "issuelinks",
  "subtasks",
  "worklog",
  "timetracking",
] as const;
type StructuredFieldId = (typeof STRUCTURED_FIELD_IDS)[number];

const STANDARD_ALIASES: Record<string, StandardFieldId | StructuredFieldId> = {
  comments: "comment",
  attachments: "attachment",
  links: "issuelinks",
  "linked issues": "issuelinks",
  worklogs: "worklog",
  "time tracking": "timetracking",
  ...Object.fromEntries(STRUCTURED_FIELD_IDS.map((id) => [id, id] as const)),
  type: "issuetype",
  "issue type": "issuetype",
  issuetype: "issuetype",
  "fix versions": "fixVersions",
  "fix version/s": "fixVersions",
  fixversions: "fixVersions",
  ...Object.fromEntries(
    STANDARD_FIELD_IDS.map((id) => [id.toLowerCase(), id] as const),
  ),
};

/** Default fields; `description` is only included when asked for or on `issues.get`. */
export const DEFAULT_SEARCH_FIELDS: readonly string[] =
  STANDARD_FIELD_IDS.filter((id) => id !== "description");
export const DEFAULT_GET_FIELDS: readonly string[] = STANDARD_FIELD_IDS;

export type JiraFieldInfo = {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
  /** Element type of array fields, e.g. `option`, `user`, `version`. */
  items?: string | null;
  /** Custom field type, e.g. `...:textarea`; system field name otherwise. */
  kind?: string | null;
};

export type FieldSelection = { id: string; key: string };

/** Resolves requested names or ids to Jira field ids plus the key used in the flattened issue. */
export async function resolveFieldSelection(
  requested: readonly string[],
  loadFields: () => Promise<JiraFieldInfo[]>,
): Promise<FieldSelection[]> {
  const selection = new Map<string, FieldSelection>();
  let catalog: JiraFieldInfo[] | undefined;
  for (const token of requested) {
    const text = token.trim();
    if (!text) continue;
    const lowered = text.toLowerCase();
    const standard = Object.hasOwn(STANDARD_ALIASES, lowered)
      ? STANDARD_ALIASES[lowered]
      : undefined;
    if (standard) {
      selection.set(standard, { id: standard, key: standard });
      continue;
    }
    if (/^customfield_\d+$/i.test(text)) {
      selection.set(text, { id: text, key: text });
      continue;
    }
    catalog ??= await loadFields();
    const lower = text.toLowerCase();
    const matches = catalog.filter(
      (field) => field.name.toLowerCase() === lower || field.id === text,
    );
    if (matches.length === 0) {
      const close = closeMatches(
        text,
        catalog.map((field) => field.name),
      );
      throw new Error(
        `Unknown Jira field "${text}".${close.length ? ` Did you mean: ${close.map((name) => `"${name}"`).join(", ")}?` : ""} Use jira.fields.list() to see all field names and ids.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Jira field name "${text}" is ambiguous (${matches.map((field) => field.id).join(", ")}); use an id.`,
      );
    }
    const match = matches[0];
    selection.set(match.id, { id: match.id, key: text });
  }
  return [...selection.values()];
}

export function defaultSelection(ids: readonly string[]): FieldSelection[] {
  return ids.map((id) => ({ id, key: id }));
}

export function flattenIssue(
  raw: unknown,
  siteUrl: string,
  selection: readonly FieldSelection[],
): Record<string, unknown> {
  const issue = asRecord(raw);
  const fields = asRecord(issue.fields);
  const key = String(issue.key ?? "");
  const out: Record<string, unknown> = {
    key,
    id: String(issue.id ?? ""),
    url: `${siteUrl}/browse/${key}`,
  };
  for (const { id, key: outKey } of selection) {
    const value = fields[id];
    switch (id) {
      case "status": {
        const status = asRecord(value);
        out.status = stringOrNull(status.name);
        out.statusCategory = stringOrNull(asRecord(status.statusCategory).name);
        break;
      }
      case "issuetype":
        out.type = nameOf(value);
        break;
      case "priority":
      case "resolution":
        out[id] = nameOf(value);
        break;
      case "assignee":
      case "reporter":
        out[id] = userOf(value);
        break;
      case "components":
      case "fixVersions":
        out[id] = Array.isArray(value)
          ? value.map((item) => nameOf(item)).filter(Boolean)
          : [];
        break;
      case "labels":
        out.labels = Array.isArray(value) ? value : [];
        break;
      case "parent": {
        const parent = asRecord(value);
        out.parent = parent.key
          ? {
              key: String(parent.key),
              summary: stringOrNull(asRecord(parent.fields).summary),
            }
          : null;
        break;
      }
      case "description":
        out.description = value ? adfToMarkdown(value) : null;
        break;
      case "comment":
        out.comment = commentsOf(value);
        break;
      case "attachment":
        out.attachment = arrayOf(value).map((raw) => {
          const item = asRecord(raw);
          return {
            id: stringOrNull(item.id),
            filename: stringOrNull(item.filename),
            size: typeof item.size === "number" ? item.size : null,
            mimeType: stringOrNull(item.mimeType),
          };
        });
        break;
      case "issuelinks":
        out.issuelinks = arrayOf(value).map((raw) => {
          const link = asRecord(raw);
          const outward = asRecord(link.outwardIssue).key !== undefined;
          const other = asRecord(
            outward ? link.outwardIssue : link.inwardIssue,
          );
          return {
            type: stringOrNull(asRecord(link.type).name),
            direction: outward ? "outward" : "inward",
            key: stringOrNull(other.key),
            summary: stringOrNull(asRecord(other.fields).summary),
          };
        });
        break;
      case "subtasks":
        out.subtasks = arrayOf(value).map((raw) => {
          const task = asRecord(raw);
          const fields = asRecord(task.fields);
          return {
            key: stringOrNull(task.key),
            summary: stringOrNull(fields.summary),
            status: nameOf(fields.status),
          };
        });
        break;
      case "worklog":
        out.worklog = arrayOf(asRecord(value).worklogs).map((raw) => {
          const entry = asRecord(raw);
          return {
            author: userOf(entry.author)?.name ?? null,
            started: stringOrNull(entry.started),
            timeSpent: stringOrNull(entry.timeSpent),
            timeSpentSeconds:
              typeof entry.timeSpentSeconds === "number"
                ? entry.timeSpentSeconds
                : null,
            comment: entry.comment ? adfToMarkdown(entry.comment) : null,
          };
        });
        break;
      case "timetracking": {
        const tracking = asRecord(value);
        out.timetracking = {
          originalEstimate: stringOrNull(tracking.originalEstimate),
          remainingEstimate: stringOrNull(tracking.remainingEstimate),
          timeSpent: stringOrNull(tracking.timeSpent),
          originalEstimateSeconds: numberOrNull(
            tracking.originalEstimateSeconds,
          ),
          remainingEstimateSeconds: numberOrNull(
            tracking.remainingEstimateSeconds,
          ),
          timeSpentSeconds: numberOrNull(tracking.timeSpentSeconds),
        };
        break;
      }
      case "summary":
      case "created":
      case "updated":
        out[id] = value ?? null;
        break;
      default:
        out[outKey] = simplifyValue(value);
    }
  }
  return out;
}

export function userOf(value: unknown) {
  const user = asRecord(value);
  if (!user.accountId && !user.displayName) return null;
  return {
    name: stringOrNull(user.displayName),
    email: stringOrNull(user.emailAddress),
    accountId: stringOrNull(user.accountId),
  };
}

/** Custom field values: option → value string, user → name, arrays mapped, ADF → Markdown. */
export function simplifyValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(simplifyValue);
  if (typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.type === "doc") return adfToMarkdown(record);
  if (typeof record.value === "string") {
    const child = asRecord(record.child);
    return typeof child.value === "string"
      ? `${record.value} / ${child.value}`
      : record.value;
  }
  if (typeof record.displayName === "string") return record.displayName;
  if (typeof record.name === "string") return record.name;
  return value;
}

export function simplifyComment(raw: unknown) {
  const comment = asRecord(raw);
  return {
    author: userOf(comment.author)?.name ?? null,
    created: stringOrNull(comment.created),
    body: adfToMarkdown(comment.body),
  };
}

function commentsOf(value: unknown) {
  return arrayOf(asRecord(value).comments).map(simplifyComment);
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function nameOf(value: unknown): string | null {
  return stringOrNull(asRecord(value).name);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
