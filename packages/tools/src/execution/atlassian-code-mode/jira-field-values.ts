import { findAssignableUser } from "../jira/users.js";
import { markdownToAdf } from "../jira/markdown-adf.js";
import { closeMatches } from "./sdk-args.js";
import { resolveFieldSelection, type JiraFieldInfo } from "./jira-issue.js";
import type { SdkEnvironment } from "./sdk-types.js";

/** What Jira says about one field of an operation (createmeta, editmeta or a transition's screen). */
export type FieldMeta = {
  id: string;
  name: string;
  required: boolean;
  hasDefault: boolean;
  type: string | null;
  items: string | null;
  kind: string | null;
  /** Display values of `allowedValues`, when Jira lists them. */
  allowed?: string[];
};

const MAX_LISTED = 40;
const ACCOUNT_ID = /^(?:[0-9a-f]{24}|\d+:[0-9a-f-]{20,})$/i;
/** Fields Jira fills in or that the operation sets from its own options. */
export const AUTOMATIC_FIELDS = new Set([
  "project",
  "issuetype",
  "reporter",
  "summary",
  "comment",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

/** Display value of an allowed-value object (`value` for options, `name` otherwise). */
function displayOf(value: unknown): string | undefined {
  const item = record(value);
  return text(item.value) ?? text(item.name) ?? undefined;
}

/** Field metadata from `fields` keyed by id (editmeta, transitions) or listed with `fieldId` (createmeta). */
export function fieldMetaMap(fields: unknown): Map<string, FieldMeta> {
  const meta = new Map<string, FieldMeta>();
  const entries: Array<[string, unknown]> = Array.isArray(fields)
    ? fields.map((raw) => [
        text(record(raw).fieldId) ?? text(record(raw).key) ?? "",
        raw,
      ])
    : Object.entries(record(fields));
  for (const [id, raw] of entries) {
    const field = record(raw);
    const schema = record(field.schema);
    const allowed = Array.isArray(field.allowedValues)
      ? field.allowedValues.flatMap((item) => displayOf(item) ?? [])
      : undefined;
    meta.set(id, {
      id,
      name: text(field.name) ?? id,
      required: field.required === true,
      hasDefault: field.hasDefaultValue === true,
      type: text(schema.type),
      items: text(schema.items),
      kind: text(schema.custom) ?? text(schema.system),
      ...(allowed && allowed.length > 0 ? { allowed } : {}),
    });
  }
  return meta;
}

export function listValues(values: readonly string[]): string {
  const shown = values.slice(0, MAX_LISTED).join(", ");
  return values.length > MAX_LISTED
    ? `${shown}, … (${values.length} in total)`
    : shown;
}

/** Required fields (without a default) the operation still lacks. */
export function missingFields(
  meta: Map<string, FieldMeta>,
  payload: Record<string, unknown>,
): FieldMeta[] {
  return [...meta.values()].filter(
    (field) =>
      field.required &&
      !field.hasDefault &&
      !AUTOMATIC_FIELDS.has(field.id) &&
      !(field.id in payload),
  );
}

/** "Name (values: a, b)" for a field a caller must or may provide. */
export function describeField(field: FieldMeta): string {
  return field.allowed
    ? `${field.name} (values: ${listValues(field.allowed)})`
    : field.name;
}

function canonical(field: FieldMeta, value: string): string {
  if (!field.allowed) return value;
  const match = field.allowed.find(
    (item) => item.toLowerCase() === value.trim().toLowerCase(),
  );
  if (match) return match;
  const close = closeMatches(value, field.allowed, 3);
  throw new Error(
    `"${value}" is not a valid value for ${field.name}.${close.length ? ` Did you mean: ${close.map((item) => `"${item}"`).join(", ")}?` : ""} Valid values: ${listValues(field.allowed)}.`,
  );
}

function strings(value: unknown, field: string): string[] {
  const items = Array.isArray(value) ? value : [value];
  if (items.some((item) => typeof item !== "string")) {
    throw new Error(`${field} takes a string or an array of strings.`);
  }
  return items as string[];
}

export type FieldScope = { projectKey?: string; issueKey?: string };

/**
 * Turns `{ "Field name": value }` into the REST `fields` object: names to ids,
 * Markdown to ADF, user names/emails to account ids, option/priority/component
 * names to the objects Jira expects. Values for unknown shapes pass through,
 * so raw REST values still work. Invalid names and values fail with the valid
 * ones listed.
 */
export async function toApiFields(
  input: Record<string, unknown>,
  env: SdkEnvironment,
  meta: Map<string, FieldMeta>,
  scope: FieldScope,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const catalog = new Map<string, JiraFieldInfo>();
  for (const [name, value] of Object.entries(input)) {
    const lowered = name.trim().toLowerCase();
    const known = [...meta.values()].find(
      (field) => field.id === name || field.name.toLowerCase() === lowered,
    );
    let id = known?.id;
    if (!id) {
      id = (await resolveFieldSelection([name], env.jiraFields))[0]?.id;
      if (!id) throw new Error(`Unknown Jira field "${name}".`);
      if (meta.size > 0 && !meta.has(id)) {
        throw new Error(
          `Field "${name}" is not available for this operation. Available: ${listValues([...meta.values()].map((field) => field.name))}.`,
        );
      }
    }
    if (catalog.size === 0) {
      for (const info of await env.jiraFields()) catalog.set(info.id, info);
    }
    const info = catalog.get(id);
    const field: FieldMeta = meta.get(id) ?? {
      id,
      name: info?.name ?? name,
      required: false,
      hasDefault: false,
      type: info?.type ?? null,
      items: info?.items ?? null,
      kind: info?.kind ?? null,
    };
    out[id] = await convert(field, value, env, scope);
  }
  return out;
}

const RICH_TEXT = new Set(["description", "environment"]);

async function convert(
  field: FieldMeta,
  value: unknown,
  env: SdkEnvironment,
  scope: FieldScope,
): Promise<unknown> {
  if (value === null || value === undefined) return null;
  const { id, type, items } = field;
  if (
    RICH_TEXT.has(id) ||
    (type === "string" && field.kind?.endsWith(":textarea"))
  ) {
    return typeof value === "string" ? markdownToAdf(value) : value;
  }
  if (type === "user" || (type === "array" && items === "user")) {
    const resolve = async (item: unknown) =>
      typeof item === "string"
        ? await userRef(item, field.name, env, scope)
        : item;
    const users =
      type === "user"
        ? [await resolve(value)]
        : await Promise.all(strings(value, field.name).map(resolve));
    return type === "user" ? users[0] : users;
  }
  if (typeof value !== "string" && !Array.isArray(value)) return value;
  if (id === "parent")
    return typeof value === "string" ? { key: value } : value;
  if (id === "labels") return strings(value, field.name);
  if (
    id === "priority" ||
    id === "resolution" ||
    id === "issuetype" ||
    type === "priority" ||
    type === "resolution"
  ) {
    return typeof value === "string"
      ? { name: canonical(field, value) }
      : value;
  }
  if (
    items === "component" ||
    items === "version" ||
    id === "components" ||
    id === "fixVersions" ||
    id === "versions"
  ) {
    return strings(value, field.name).map((item) => ({
      name: canonical(field, item),
    }));
  }
  if (type === "option" || (type === "array" && items === "option")) {
    const options = strings(value, field.name).map((item) => {
      const [parent, child, ...more] = item.split(" / ");
      if (child !== undefined && more.length === 0) {
        return { value: parent.trim(), child: { value: child.trim() } };
      }
      return { value: canonical(field, item) };
    });
    return type === "option" ? options[0] : options;
  }
  return value;
}

/** An account id, or the one active assignable user a name or email refers to. */
async function userRef(
  query: string,
  field: string,
  env: SdkEnvironment,
  scope: FieldScope,
): Promise<{ accountId: string }> {
  if (ACCOUNT_ID.test(query)) return { accountId: query };
  const { user, candidates } = await findAssignableUser(
    await env.jira(),
    query,
    { ...scope, signal: env.context.signal },
  );
  if (user) return { accountId: user.accountId };
  const where = scope.issueKey ?? scope.projectKey ?? "this site";
  if (candidates.length === 0) {
    throw new Error(
      `No assignable user matched "${query}" for ${field} on ${where}. Use an exact email or name; jira.users.search lists users.`,
    );
  }
  throw new Error(
    `Several users match "${query}" for ${field}: ${candidates
      .slice(0, 5)
      .map((user) => `${user.displayName} <${user.emailAddress ?? "no email"}>`)
      .join("; ")}. Use the email.`,
  );
}
