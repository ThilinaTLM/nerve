import { type JiraConnection, jiraRequest } from "./client.js";

export async function fetchJiraFields(
  connection: JiraConnection,
  options: { query?: string; maxResults: number; signal?: AbortSignal },
): Promise<unknown> {
  return jiraRequest(connection, {
    path: "/field/search",
    query: { query: options.query, maxResults: options.maxResults },
    signal: options.signal,
  }).catch(() =>
    jiraRequest(connection, { path: "/field", signal: options.signal }),
  );
}

export function valuesFromJiraList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.values)) return record.values;
  }
  return [];
}

export function fieldsFromProjectResult(
  result: Record<string, unknown>,
): unknown[] {
  const directFields = valuesFromJiraList(result.fields);
  const createMeta = result.createMeta;
  if (!createMeta || typeof createMeta !== "object") return directFields;
  const fields = (createMeta as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    return directFields;
  return [
    ...directFields,
    ...Object.entries(fields).map(([id, value]) =>
      value && typeof value === "object"
        ? { id, ...(value as Record<string, unknown>) }
        : { id, value },
    ),
  ];
}

export function issueTypeIdFromName(
  issueTypes: unknown,
  issueTypeName: string | undefined,
): string | undefined {
  if (!issueTypeName) return undefined;
  return valuesFromJiraList(issueTypes)
    .map((item) => (item && typeof item === "object" ? item : undefined))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .find(
      (item) => normalize(String(item.name ?? "")) === normalize(issueTypeName),
    )?.id as string | undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
