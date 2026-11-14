/** A Jira user as shown to a script: text fields bounded, absent fields omitted. */
export type JiraUserSummaryPayload = {
  accountId: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
  accountType?: string;
};

export const JIRA_TEXT_FIELD_MAX_CHARS = 300;

export function summarizeJiraUser(
  value: unknown,
): JiraUserSummaryPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const accountId = stringField(record.accountId);
  if (!accountId) return undefined;
  return compactRecord({
    accountId,
    displayName: truncateField(displayNameOf(record)),
    emailAddress: truncateField(stringField(record.emailAddress)),
    active: typeof record.active === "boolean" ? record.active : undefined,
    accountType: truncateField(stringField(record.accountType)),
  }) as JiraUserSummaryPayload;
}

export function nameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

function truncateField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= JIRA_TEXT_FIELD_MAX_CHARS) return normalized;
  return `${normalized.slice(0, JIRA_TEXT_FIELD_MAX_CHARS - 1)}…`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function displayNameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.displayName === "string"
    ? record.displayName
    : nameOf(value);
}

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
