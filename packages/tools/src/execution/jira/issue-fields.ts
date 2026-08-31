import { optionalString, optionalStringArray } from "../atlassian/arguments.js";

export function rawFields(value: unknown): Record<string, unknown> {
  return rawOptionalRecord(value, "fields");
}

export function rawOptionalRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

export function applyCommonFields(
  fields: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  const labels = optionalStringArray(args.labels);
  if (labels) fields.labels = labels;
  const priority = optionalString(args.priority);
  if (priority) fields.priority = { name: priority };
  const assignee = optionalString(args.assignee_account_id);
  if (assignee) fields.assignee = { accountId: assignee };
  const components = optionalStringArray(args.components);
  if (components) fields.components = components.map((name) => ({ name }));
}
